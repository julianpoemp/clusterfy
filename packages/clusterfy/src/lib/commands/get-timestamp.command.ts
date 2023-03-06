import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';

export class ClusterfyTimestampGetCommand extends ClusterfyCommand {
  constructor() {
    super(undefined);
    this.name = 'get_timestamp';
    this.target = 'worker';
  }

  runOnTarget = async (
    { path, value }: { path: string; value: any },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    return {
      status: 'success',
      data: 'timestamp is ' + new Date().toISOString(),
    } as ClusterfyCommandRequestResult<any>;
  };
}
