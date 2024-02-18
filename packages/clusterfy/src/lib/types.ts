import { ServerOpts } from 'net';

export class ClusterfyIPCOptions {}

export class ClusterfyWorkerSocketOptions {
  path?: string;
  pipe?: string;
}

export class ClusterfySocketOptions implements ServerOpts {
  enabled = false;
  path?: string;
  pipe?: string;

  /**
   * Indicates whether half-opened TCP connections are allowed.
   * @default false
   */
  allowHalfOpen?: boolean | undefined;
  /**
   * Indicates whether the socket should be paused on incoming connections.
   * @default false
   */
  pauseOnConnect?: boolean | undefined;
  /**
   * If set to `true`, it disables the use of Nagle's algorithm immediately after a new incoming connection is received.
   * @default false
   * @since v16.5.0
   */
  noDelay?: boolean | undefined;
  /**
   * If set to `true`, it enables keep-alive functionality on the socket immediately after a new incoming connection is received,
   * similarly on what is done in `socket.setKeepAlive([enable][, initialDelay])`.
   * @default false
   * @since v16.5.0
   */
  keepAlive?: boolean | undefined;
  /**
   * If set to a positive number, it sets the initial delay before the first keepalive probe is sent on an idle socket.
   * @default 0
   * @since v16.5.0
   */
  keepAliveInitialDelay?: number | undefined;
}

export class ClusterfyTCPOptions{
  enabled = false;
}

export class ClusterfyOptions {
  shutdown?: ClusterfyShutdownOptions;
}

export class ClusterfyPrimaryOptions {
  shutdown?: ClusterfyShutdownOptions;
  ipc?: {
    socket?: ClusterfySocketOptions;
    tcp?: ClusterfyIPCOptions;
  }

  constructor(partial: Partial<ClusterfyPrimaryOptions>) {
    Object.assign(this, {
      ...this,
      ...partial,
    });
  }
}

export enum ClusterfyIPCMethod{
  "message" = "message",
  "socket" = "socket",
  "tcp" = "tcp"
}

export class ClusterfyWorkerOptions {
  shutdown?: ClusterfyShutdownOptions;
  name?: string;
  revive?: boolean;

  constructor(partial: Partial<ClusterfyWorkerOptions>) {
    Object.assign(this, {
      ...this,
      ...partial,
    });
  }
}

export class ClusterfyShutdownOptions {
  gracefulOnSignals?: NodeJS.Signals[];
}

export interface ClusterfySerializedWorker {
  name?: string;
  id?: number;
}

export interface ClusterfyIPCEvent {
  type:
    | 'command'
    | 'online'
    | 'ready'
    | 'result'
    | 'disconnect'
    | 'error'
    | 'exit'
    | 'listening'
    | 'status';
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
