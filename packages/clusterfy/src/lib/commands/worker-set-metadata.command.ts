import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';
import { Clusterfy } from 'clusterfy';

export class ClusterfyWorkerMetadataCommand extends ClusterfyCommand {
  constructor() {
    super(undefined);
    this.name = 'cy_worker_set_metadata';
    this.target = 'worker';
  }

  runOnTarget = async (
    { name }: { name: string },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    Clusterfy.currentWorker.name = name;

    return {
      status: 'success',
    } as ClusterfyCommandRequestResult<any>;
  };
}
