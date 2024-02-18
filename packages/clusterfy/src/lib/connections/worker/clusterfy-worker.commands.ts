import * as _cluster from 'cluster';
import { ClusterfyCommandRequest, ClusterfyCommandRequestResult } from '../../types';
import * as process from 'process';
import { ClusterfyCommand } from '../../commands';
import { ClusterfyWorkerStatus } from './clusterfy-worker';
import { ClusterfyWorkerConnection } from './worker-connection';
import { Clusterfy } from '../../clusterfy';

const cluster = _cluster as unknown as _cluster.Cluster;

export class WorkerCommands {
  constructor(private connection: ClusterfyWorkerConnection) {
  }

  cy_shutdown = new ClusterfyCommand('worker', async (
    {
      commands
    }: {
      commands: {
        name: string;
        command: (signal?: NodeJS.Signals) => Promise<void>;
      }[];
    },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (!cluster.isPrimary) {
      if (this.connection.currentWorker.status === ClusterfyWorkerStatus.IDLE) {
        for (const command of commands) {
          await command.command();
        }

        process.exit(0);
      } else {
        this.connection.changeCurrentWorkerStatus(ClusterfyWorkerStatus.STOPPING);
        // the process should shut down itself
      }

      return {
        status: 'success'
      } as ClusterfyCommandRequestResult<void>;
    } else { // TODO commands depend on context primary/worker, so we don't need exceptions here
      return {
        status: 'error',
        error: {
          message: `Command cy_shutdown must be called on worker!`
        }
      } as ClusterfyCommandRequestResult<void>;
    }
  });

  cy_status_change = new ClusterfyCommand('primary', async (
    {
      oldStatus,
      newStatus
    }: {
      oldStatus: ClusterfyWorkerStatus;
      newStatus: ClusterfyWorkerStatus;
    },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {

    if (cluster.isPrimary) {
      const index = this.connection.workers.findIndex(
        (a) => a.worker.id === commandEvent.sender?.id
      );

      if (index > -1) {
        const data = {
          oldStatus,
          newStatus
        };
        this.connection.workers[index].changeStatus(newStatus);

        return {
          status: 'success',
          data
        } as ClusterfyCommandRequestResult<{
          oldStatus: ClusterfyWorkerStatus;
          newStatus: ClusterfyWorkerStatus;
        }>;
      } else {
        return {
          status: 'error',
          message: `Can't set status for worker ${commandEvent.sender.id} on primary. Not found.`
        } as ClusterfyCommandRequestResult<{
          oldStatus: ClusterfyWorkerStatus;
          newStatus: ClusterfyWorkerStatus;
        }>;
      }
    } else {
      throw Error(`Command cy_status_change must be called on primary!`);
    }
  });

  cy_worker_set_metadata = new ClusterfyCommand("worker", async (
    { name }: { name: string },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (cluster.isPrimary) {
      return {
        status: 'error',
        error: {
          message: `cy_worker_set_metadata can be called on worker only`,
        },
      } as ClusterfyCommandRequestResult<any>;
    }

    return {
      status: 'success',
      data: {
        name,
      },
    } as ClusterfyCommandRequestResult<any>;
  })
}
