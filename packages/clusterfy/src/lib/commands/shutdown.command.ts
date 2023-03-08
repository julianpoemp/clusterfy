import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
  ClusterfyWorkerStatus,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';
import { Clusterfy } from '../clusterfy';
import * as process from 'process';

export class ClusterfyShutdownCommand extends ClusterfyCommand {
  constructor() {
    super(undefined);
    this.name = 'cy_shutdown';
    this.target = 'worker';
  }

  runOnTarget = async (
    {
      commands,
    }: {
      commands: {
        name: string;
        command: (signal?: NodeJS.Signals) => Promise<void>;
      }[];
    },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (!Clusterfy.isCurrentProcessPrimary()) {
      if (Clusterfy.currentWorker.status === ClusterfyWorkerStatus.IDLE) {
        for (const command of commands) {
          await command.command();
        }

        process.exit(0);
      } else {
        Clusterfy.changeCurrentWorkerStatus(ClusterfyWorkerStatus.STOPPING);
        // the process should shut down itself
      }

      return {
        status: 'success',
      } as ClusterfyCommandRequestResult<void>;
    } else {
      return {
        status: 'error',
        error: {
          message: `Command ${this.name} must be called on worker!`,
        },
      } as ClusterfyCommandRequestResult<void>;
    }
  };
}
