import { RIVER_STRIDE, TerrainType, type TerrainData } from "@critter-evo/core";
import { BufferImageSource, Container, GlProgram, Graphics, Mesh, MeshGeometry, Shader, UniformGroup } from "pixi.js";
import {
  buildPalette,
  PALETTE_ROWS,
  PALETTE_WIDTH,
  sampleStops,
  TEMPERATURE_RANGE,
  TERRAIN_TYPE_COLORS,
  TERRAIN_VIEWS,
  WATER_STOPS,
  type RGB,
  type TerrainView,
} from "./terrainColors";
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX } from "./terrainShader";

/** World units of vertical exaggeration per unit of normalized elevation, for hillshading. */
const RELIEF_SCALE = 150;
/** Uniforms can't hold Infinity reliably, and every level is a 0..1 value or °F, so this means "never". */
const NEVER = 1e9;
/** Depth used to color shallow and deep rivers in the water ramp. */
const SHALLOW_RIVER_DEPTH = 0.12;
const DEEP_RIVER_DEPTH = 0.45;

function toHex(color: RGB): number {
  return (Math.round(color[0]) << 16) | (Math.round(color[1]) << 8) | Math.round(color[2]);
}

/**
 * Draws the terrain: the continuous field with a GPU shader (see terrainShader.ts),
 * and rivers as capsules on top, exactly as the simulation's river queries see them.
 */
export class TerrainLayer {
  readonly container = new Container();
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly rivers = new Graphics();
  private readonly uniforms: UniformGroup;
  private readonly dataSource: BufferImageSource;
  private readonly paletteSource: BufferImageSource;

  constructor(private readonly terrain: TerrainData) {
    const n = terrain.cols * terrain.rows;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = terrain.elevation[i]!;
      data[i * 4 + 1] = terrain.temperature[i]!;
      data[i * 4 + 2] = terrain.moisture[i]!;
      data[i * 4 + 3] = terrain.water[i]!;
    }
    this.dataSource = new BufferImageSource({
      resource: data,
      width: terrain.cols,
      height: terrain.rows,
      format: "rgba32float",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
      alphaMode: "no-premultiply-alpha",
    });
    this.paletteSource = new BufferImageSource({
      resource: buildPalette(),
      width: PALETTE_WIDTH,
      height: PALETTE_ROWS,
      format: "rgba8unorm",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
      alphaMode: "no-premultiply-alpha",
    });

    const levels = terrain.levels;
    const finite = (v: number) => Math.min(NEVER, v);
    this.uniforms = new UniformGroup({
      uGridSize: { value: new Float32Array([terrain.cols, terrain.rows]), type: "vec2<f32>" },
      uCellSize: { value: terrain.cellSize, type: "f32" },
      uElevationLevels: {
        value: new Float32Array([finite(levels.sea), finite(levels.deep), finite(levels.mountain), RELIEF_SCALE]),
        type: "vec4<f32>",
      },
      uWater: { value: new Float32Array([levels.maxDepth, 0, 0, 0]), type: "vec4<f32>" },
      uClimateLevels: {
        value: new Float32Array([finite(levels.dry), finite(levels.wet), finite(levels.cold), finite(levels.hot)]),
        type: "vec4<f32>",
      },
      uView: {
        value: new Float32Array([0, 1, TEMPERATURE_RANGE.min, TEMPERATURE_RANGE.max]),
        type: "vec4<f32>",
      },
    });

    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: TERRAIN_VERTEX, fragment: TERRAIN_FRAGMENT, name: "terrain" }),
      resources: {
        terrainUniforms: this.uniforms,
        uData: this.dataSource,
        uPalette: this.paletteSource,
      },
    });

    const { width, height } = terrain;
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.mesh = new Mesh({ geometry, shader });
    this.container.addChild(this.mesh, this.rivers);
    this.drawRivers("biome");
  }

  setView(view: TerrainView, relief: boolean): void {
    const uView = this.uniforms.uniforms["uView"] as Float32Array;
    uView[0] = TERRAIN_VIEWS.find((v) => v.value === view)?.index ?? 0;
    uView[1] = relief ? 1 : 0;
    this.uniforms.update();
    this.drawRivers(view);
  }

  /** Each segment is a capsule: a stroke with round caps, matching riverWidthAt() in core. */
  private drawRivers(view: TerrainView): void {
    this.rivers.clear();
    // Rivers would hide the temperature pattern, which they don't affect.
    if (view === "temperature") return;
    const shallow =
      view === "terrain" ? toHex(TERRAIN_TYPE_COLORS[TerrainType.ShallowWater]!) : toHex(sampleStops(WATER_STOPS, SHALLOW_RIVER_DEPTH));
    const deep =
      view === "terrain" ? toHex(TERRAIN_TYPE_COLORS[TerrainType.DeepWater]!) : toHex(sampleStops(WATER_STOPS, DEEP_RIVER_DEPTH));
    const r = this.terrain.rivers;
    const deepWidth = this.terrain.levels.deepRiverWidth;
    for (let o = 0; o < r.length; o += RIVER_STRIDE) {
      const width = r[o + 4]!;
      this.rivers
        .moveTo(r[o]!, r[o + 1]!)
        .lineTo(r[o + 2]!, r[o + 3]!)
        .stroke({ width, color: width >= deepWidth ? deep : shallow, cap: "round" });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.dataSource.destroy();
    this.paletteSource.destroy();
  }
}
