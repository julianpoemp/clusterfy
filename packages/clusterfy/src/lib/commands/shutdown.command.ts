import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';
import { Clusterfy } from 'clusterfy';
import * as process from 'process';

export class ClusterfyShutdownCommand extends ClusterfyCommand {
  constructor() {
    super(undefined);
    this.name = 'cy_shutdown';
    this.target = 'worker';
  }

  runOnTarget = async (
    { path, value }: { path: string; value: any },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (!Clusterfy.isCurrentProcessPrimary()) {
      if (Clusterfy.currentWorker.status === 'idle') {
        process.exit(0);
      } else {
        Clusterfy.currentWorker.status = 'stopping';
        // the process should shut down itself
      }
      return {
        status: 'success',
      } as ClusterfyCommandRequestResult<void>;
    } else {
      throw Error(`Command ${this.name} must be called on worker!`);
    }
  };
}
