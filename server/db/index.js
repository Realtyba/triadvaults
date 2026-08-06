import { initDatabase, closeDatabase, activeStorage } from './pool.js';
import * as users from './users.repo.js';
import * as recovery from './recovery.repo.js';
import { saveProgress } from './progress.repo.js';
import { getLeaderboard } from './leaderboard.repo.js';
import {
  listAchievements,
  grantAchievements,
  getCatalog,
  seedCatalog,
  invalidateCatalog
} from './achievements.repo.js';

export { initDatabase, closeDatabase, activeStorage };

/**
 * Fachada estable sobre los repositorios.
 * Se mantiene la forma `DatabaseManager.metodo()` para no tocar todas las llamadas.
 */
export const DatabaseManager = {
  registerUser: users.registerUser,
  loginUser: users.loginUser,
  getMaxLevel: users.getMaxLevel,
  verifyEmail: users.verifyEmail,
  regenerateVerificationCode: users.regenerateVerificationCode,
  updateProfile: users.updateProfile,
  requestPasswordReset: recovery.requestPasswordReset,
  resetPassword: recovery.resetPassword,
  saveProgress,
  getLeaderboard,
  listAchievements,
  grantAchievements,
  getAchievementCatalog: getCatalog,
  seedAchievementCatalog: seedCatalog,
  invalidateAchievementCatalog: invalidateCatalog
};
