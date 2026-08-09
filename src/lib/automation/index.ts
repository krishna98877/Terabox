export { executeSignup, cleanupEmail, getDashboardStats, initializeEngine } from './engine';
export {
  startAutoSignupScheduler,
  stopAutoSignupScheduler,
  isSchedulerRunning,
  startPool,
  stopPool,
  isPoolActive,
  getWorkerStates,
  getMaxWorkers,
} from './scheduler';
export type { WorkerSlot } from './scheduler';
