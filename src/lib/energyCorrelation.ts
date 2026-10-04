/**
 * energyCorrelation.ts — CLIENT RE-EXPORT WRAPPER
 *
 * The canonical algorithm lives in netlify/functions/_shared/energyCorrelation.ts
 * so it can be imported by both Netlify functions (server) and the Vite/React
 * client bundle.
 *
 * This file is a pure re-export — it adds no logic.
 * All client code (InsightsTab, personalFoodIntelligence) continues to
 * import from '../../lib/energyCorrelation' without changes.
 *
 * WHY:
 *   Netlify functions cannot import from src/lib/ at runtime.
 *   The _shared/ directory is the established pattern for cross-function code.
 *   Moving the implementation there and re-exporting here preserves ONE source
 *   of truth while satisfying the import constraint.
 */
export * from './energyCorrelationImpl';
