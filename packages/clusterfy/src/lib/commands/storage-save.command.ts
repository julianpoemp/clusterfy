import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
} from '../types';
import { ClusterfyCommand } from './clusterfy-command';
import { Clusterfy } from 'clusterfy';

export class ClusterfyStorageSaveCommand extends ClusterfyCommand {
  constructor() {
    super(undefined);
    this.name = 'cy_storage_save';
    this.target = 'primary';
  }

  runOnTarget = async (
    { path, value }: { path: string; value: any },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    if (Clusterfy.isCurrentProcessPrimary()) {
      Clusterfy.storage.save(path, value);
      const result = {
        status: 'success',
        data: undefined,
      } as ClusterfyCommandRequestResult<any>;

      return result;
    } else {
      throw Error(`Command ${this.name} must be called on primary!`);
    }
  };
}
