import {
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
} from '../types';

export class ClusterfyCommand {
  public readonly target: 'primary' | 'worker';
  public readonly runOnTarget: (
    args: Record<string, any>,
    commandEvent?: ClusterfyCommandRequest<any>
  ) => Promise<ClusterfyCommandRequestResult<any>>;

  constructor(target: 'primary' | 'worker', runOnTarget: (
    args: Record<string, any>,
    commandEvent?: ClusterfyCommandRequest<any>
  ) => Promise<ClusterfyCommandRequestResult<any>>) {
    this.target = target;
    this.runOnTarget = runOnTarget;
  }
}
