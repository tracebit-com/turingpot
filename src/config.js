import settings from '../default.json' with { type: 'json' };
import { puzzleTypes } from './manifest.js';

export function validateConfig(config) {
  for (const field of ['siteTitle', 'collectionName', 'description']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) {
      throw new Error('default.json: ' + field + ' must contain text');
    }
  }
  if (typeof config.apiPath !== 'string' || !/^\/api\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.apiPath)) {
    throw new Error('default.json: apiPath must be a path such as /api/service-catalog');
  }
  if (!Array.isArray(config.puzzles) || !config.puzzles.length ||
      !config.puzzles.every(name => typeof name === 'string' && Object.hasOwn(puzzleTypes, name))) {
    throw new Error('default.json: select at least one puzzle from ' + Object.keys(puzzleTypes).join(', '));
  }
  for (const name of config.puzzles) {
    if (typeof config.instructions?.[name] !== 'string' || !config.instructions[name].trim()) {
      throw new Error('default.json: missing instructions for ' + name);
    }
  }
  if (config.puzzles.includes('journal') && !config.instructions.journal.includes('{ledger}')) {
    throw new Error('default.json: journal instructions must include {ledger}');
  }
  // A bounded sequence keeps the encrypted client history within the submission size limit.
  if (!Number.isInteger(config.earlySignalAfter) || !Number.isInteger(config.completeAfter) ||
      config.earlySignalAfter < 1 || config.earlySignalAfter >= config.completeAfter || config.completeAfter > 20) {
    throw new Error('default.json: earlySignalAfter and completeAfter must be increasing integers between 1 and 20');
  }
  return config;
}

export const config = validateConfig(settings);
