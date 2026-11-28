// Child process for updater-restart.test.ts — prints how relaunch() would treat
// this environment. It must never call relaunch() itself: on a "self" start that
// would spawn a real bot process.
import { isSupervised } from '../../src/lib/updater.ts'

process.stdout.write(isSupervised() ? 'supervised' : 'self')
