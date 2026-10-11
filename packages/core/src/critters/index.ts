export { Critters, type CritterInfo, type CritterSnapshot, type CritterTraits } from "./critters.js";
export {
  CONTROLLER_NAMES,
  ControllerKind,
  IdleController,
  KeyboardController,
  WanderController,
  type ControlContext,
  type Controller,
  type Outputs,
} from "./controllers.js";
export {
  accelerationOf,
  bodyFits,
  massOf,
  RADIUS_PER_SIZE,
  radiusOf,
  slopeFactor,
  terrainEffect,
  wadingFactor,
  type TerrainEffect,
} from "./movement.js";
