export interface ClusterfyWorkerOptions {
  name?: string;
  revive?: boolean;
}

export interface ClusterfySerializedWorker {
  name?: string;
  id?: number;
}

export interface ClusterfyIPCEvent {
  type:
    | 'command'
    | 'online'
    | 'result'
    | 'disconnect'
    | 'error'
    | 'exit'
    | 'listening';
  data?: any;
  sender?: ClusterfySerializedWorker;
  target?: ClusterfySerializedWorker;
  origin?: ClusterfySerializedWorker;
  timestamp: number;
}

export interface ClusterfyCommandRequestResult<T> extends Record<string, any> {
  status: 'success' | 'error';
  error?: {
    message?: string;
    stack?: string;
  };
  data?: T;
}

export interface ClusterfyCommandRequest<T> extends ClusterfyIPCEvent {
  type: 'command';
  data: {
    command: string;
    args: Record<string, any>;
    uuid: string;
    result?: ClusterfyCommandRequestResult<T>;
  };
}

export interface ClusterfyWorkerStatisticItem {
  id: number;
  name: string;
  status: ClusterfyWorkerStatus;
}

export interface ClusterfyWorkerStatistics {
  list: ClusterfyWorkerStatisticItem[];
  workersOnline: number;
}

export enum ClusterfyWorkerStatus {
  // worker is online and does nothing
  "IDLE" = "IDLE'IDLE'/ w'IDLE'is online and is processing something
  "PROCESSING" ='PROCESSING'",
'PROCESSING'is requested to stop. Last status before death
  "STOPPING" = "'STOPPING'}
