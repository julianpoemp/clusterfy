import {ClusterfyCommandRequest, ClusterfyCommandRequestResult} from '../types';
import {ClusterfyCommand} from './clusterfy-command';
import {Clusterfy} from 'clusterfy';

export class ClusterfyStorageRetrieveCommand extends ClusterfyCommand {
    constructor() {
        super(undefined);
        this.name = 'storage_retrieve';
        this.target = 'primary';
    }

    runOnTarget = async ({path, value}: { path: string, value: any }, commandEvent?: ClusterfyCommandRequest<any>) => {
        if (Clusterfy.isCurrentProcessPrimary()) {
            const data = Clusterfy.storage.retrieve(path);
            const result = {
                status: 'success',
                data
            } as ClusterfyCommandRequestResult<any>;

            return result;
        } else {
            throw Error(`Command ${this.name} must be called on primary!`);
        }
    }
}
