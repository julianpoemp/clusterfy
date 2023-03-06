import {ClusterfyCommandRequest, ClusterfyCommandRequestResult} from '../types';

export class ClusterfyCommand {
    name: string;
    target: 'primary' | 'worker';
    runOnTarget: (args: Record<string, any>, commandEvent?: ClusterfyCommandRequest<any>) => Promise<ClusterfyCommandRequestResult<any>>;

    constructor(options?: Partial<ClusterfyCommand>) {
        if (options) {
            Object.assign(this, options);
        }
    }
}
