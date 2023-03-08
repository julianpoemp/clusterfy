import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';
import * as _cluster from 'cluster';
import { Clusterfy } from '../clusterfy';

const cluster = _cluster as unknown as _cluster.Cluster;

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
    if (Clusterfy.isCurrentProcessPrimary()) {
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
  };
}
