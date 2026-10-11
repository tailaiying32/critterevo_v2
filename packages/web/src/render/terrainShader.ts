import { BIOME_TABLE } from "@critter-evo/core";
import { MiscColor, PaletteRow } from "./terrainColors";

/**
 * GPU terrain shader. It draws the continuous terrain field: for every screen
 * pixel it blends the four nearest samples bilinearly and classifies the result,
 * using the same math as core's terrain/sample.ts. What you see is exactly what
 * the simulation uses, smooth at any zoom.
 *
 * Data texture (RGBA32F, one texel per sample): R elevation, G temperature °F, B moisture,
 * A signed water depth (positive in seas and lakes). Rivers are drawn separately as capsules.
 */

export const TERRAIN_VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vWorld;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vWorld = aPosition;
}
`;

const biomeTable = BIOME_TABLE.flat();

export const TERRAIN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 vWorld;
out vec4 finalColor;

uniform highp sampler2D uData;
uniform highp sampler2D uPalette;

uniform vec2 uGridSize;        // cols, rows
uniform float uCellSize;       // sample spacing in world units
uniform vec4 uElevationLevels; // sea, deep water depth, mountain, relief scale
uniform vec4 uWater;           // deepest water depth, unused x3
uniform vec4 uClimateLevels;   // dry, wet, cold, hot
uniform vec4 uView;            // view index, relief on, temperature min, temperature max

// Generated from core's BIOME_TABLE[temperatureBand][moistureBand].
const int BIOME_TABLE[${biomeTable.length}] = int[${biomeTable.length}](${biomeTable.join(", ")});

const int ROW_BIOME = ${PaletteRow.Biome};
const int ROW_TERRAIN = ${PaletteRow.TerrainType};
const int ROW_WATER = ${PaletteRow.Water};
const int ROW_ELEVATION = ${PaletteRow.Elevation};
const int ROW_TEMPERATURE = ${PaletteRow.Temperature};
const int ROW_MOISTURE = ${PaletteRow.Moisture};
const int ROW_MISC = ${PaletteRow.Misc};
const int MISC_ROCK = ${MiscColor.Rock};
const int MISC_SNOW = ${MiscColor.Snow};

vec4 fetchSample(ivec2 c) {
  ivec2 maxC = ivec2(uGridSize) - 1;
  return texelFetch(uData, clamp(c, ivec2(0), maxC), 0);
}

// Bilinear blend between sample centers; matches sampleField() in core.
vec4 fieldAt(vec2 p) {
  vec2 g = p / uCellSize - 0.5;
  vec2 g0 = floor(g);
  vec2 f = g - g0;
  ivec2 i0 = ivec2(g0);
  vec4 a = fetchSample(i0);
  vec4 b = fetchSample(i0 + ivec2(1, 0));
  vec4 c = fetchSample(i0 + ivec2(0, 1));
  vec4 d = fetchSample(i0 + ivec2(1, 1));
  vec4 top = a + (b - a) * f.x;
  vec4 bottom = c + (d - c) * f.x;
  return top + (bottom - top) * f.y;
}

vec3 paletteColor(int row, int index) {
  return texelFetch(uPalette, ivec2(index, row), 0).rgb;
}

vec3 ramp(int row, float t) {
  return paletteColor(row, int(clamp(t, 0.0, 1.0) * 255.0 + 0.5));
}

// Brightness from the local slope, lit from the northwest. Flat ground is 1.
float hillshade(vec2 p) {
  float h = uCellSize;
  float left = fieldAt(p - vec2(h, 0.0)).r;
  float right = fieldAt(p + vec2(h, 0.0)).r;
  float up = fieldAt(p - vec2(0.0, h)).r;
  float down = fieldAt(p + vec2(0.0, h)).r;
  float scale = uElevationLevels.w;
  float dzdx = (right - left) * scale / (2.0 * h);
  float dzdy = (down - up) * scale / (2.0 * h);
  float len = sqrt(dzdx * dzdx + dzdy * dzdy + 1.0);
  float lambert = (dzdx + dzdy + 1.41421356) / (2.0 * len);
  return clamp(lambert / 0.70710678, 0.45, 1.3);
}

void main() {
  vec4 field = fieldAt(vWorld);
  float e = field.r;
  float temperature = field.g;
  float moisture = field.b;
  float waterLevel = field.a;

  // Same classification as classifyTerrain() in core.
  bool water = waterLevel > 0.0;
  int terrainType = water ? (waterLevel >= uElevationLevels.y ? 0 : 1) : (e >= uElevationLevels.z ? 3 : 2);
  float depth = water ? waterLevel / max(uWater.x, 1e-6) : 0.0;
  float seaRef = min(uElevationLevels.x, 1.0);
  float height = (!water && seaRef < 1.0) ? max(0.0, e - seaRef) / (1.0 - seaRef) : 0.0;

  int view = int(uView.x + 0.5);
  vec3 color;
  if (view == 0) {
    if (water) {
      color = ramp(ROW_WATER, depth);
    } else {
      int tBand = temperature < uClimateLevels.z ? 0 : (temperature >= uClimateLevels.w ? 2 : 1);
      int mBand = moisture >= uClimateLevels.y ? 2 : (moisture < uClimateLevels.x ? 0 : 1);
      color = paletteColor(ROW_BIOME, BIOME_TABLE[tBand * 3 + mBand]);
      if (terrainType == 3) {
        color = temperature < 32.0
          ? mix(color, paletteColor(ROW_MISC, MISC_SNOW), 0.6)
          : mix(color, paletteColor(ROW_MISC, MISC_ROCK), 0.4);
      }
    }
  } else if (view == 1) {
    color = water ? ramp(ROW_WATER, depth) : ramp(ROW_ELEVATION, height);
  } else if (view == 2) {
    color = ramp(ROW_TEMPERATURE, (temperature - uView.z) / (uView.w - uView.z));
  } else if (view == 3) {
    color = water ? ramp(ROW_WATER, 0.3) : ramp(ROW_MOISTURE, moisture);
  } else {
    color = paletteColor(ROW_TERRAIN, terrainType);
  }

  if (uView.y > 0.5 && !water) color *= hillshade(vWorld);
  finalColor = vec4(color, 1.0);
}
`;
