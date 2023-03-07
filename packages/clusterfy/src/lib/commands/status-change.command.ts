import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
  ClusterfyWorkerStatus,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';
import { Clusterfy } from '../clusterfy';

export class ClusterfyStatusChangeCommand extends ClusterfyCommand {
  constructor() {
    super(undefined);
    this.name = 'cy_status_change';
    this.target = 'primary';
  }

  runOnTarget = async (
    { newStatus }: { newStatus: ClusterfyWorkerStatus },
    commandEvent?: ClusterfyCommandRequest<{
      oldStatus: ClusterfyWorkerStatus;
      newStatus: ClusterfyWorkerStatus;
    }>
  ) => {
    if (Clusterfy.isCurrentProcessPrimary()) {
      const index = Clusterfy.workers.findIndex(
        (a) => a.worker.id === commandEvent.sender?.id
      );

      if (index > -1) {
        const data = {
          oldStatus: Clusterfy.workers[index].status,
          newStatus,
        };
        Clusterfy.workers[index].changeStatus(newStatus);

        return {
          status: 'success',
          data,
        } as ClusterfyCommandRequestResult<{
          oldStatus: ClusterfyWorkerStatus;
          newStatus: ClusterfyWorkerStatus;
        }>;
      } else {
        return {
          status: 'error',
          message: `Can't set status for worker ${commandEvent.sender.id} on primary. Not found.`,
        } as ClusterfyCommandRequestResult<{
          oldStatus: ClusterfyWorkerStatus;
          newStatus: ClusterfyWorkerStatus;
        }>;
      }
    } else {
      throw Error(`Command ${this.name} must be called on worker!`);
    }
  };
}
