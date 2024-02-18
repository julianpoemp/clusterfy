import {
  Clusterfy,
  ClusterfyCommandRequest,
  ClusterfyCommandRequestResult,
  ClusterfyWorkerConnection
} from 'clusterfy';
import * as _cluster from 'cluster';
import { ClusterfyCommand } from '../../../packages/clusterfy/src/lib/commands';

const cluster = _cluster as unknown as _cluster.Cluster;
let connection: ClusterfyWorkerConnection;


export class DemoCommands {
  constructor(private connection: ClusterfyWorkerConnection) {
  }

  cy_get_timestamp = new ClusterfyCommand('worker', async (
    {
      commands
    }: {
      commands: {
        name: string;
        command: (signal?: NodeJS.Signals) => Promise<void>;
      }[];
    },
    commandEvent?: ClusterfyCommandRequest<any>
  ) => {
    return {
      status: 'success',
      data: 'timestamp is ' + new Date().toISOString()
    } as ClusterfyCommandRequestResult<any>;
  });
}

const wait = async (time: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const onShutdown = async () => {
  console.log(`${ClusterfyWorkerConnection}: Simulate cleanup on shutdown...`);

  let j = 0;
  for (let i = 0; i < 100000; i++) {
    j++;
  }
  console.log(`${connection.currentWorker.name ?? 'Primary'}: All cleaned up.`);
};

async function main() {
  if (cluster.isPrimary) {
    console.log("IS PRIMARY");
    // the primary thread of this application should be primary
    await Clusterfy.initAsPrimary({
      shutdown: {
        gracefulOnSignals: ['SIGINT', 'SIGTERM']
      }
    });
  } else {
    console.log("IS WORKER");
  }

  connection = await Clusterfy.connect({
    ipc: {
      message: {
        enabled: true
      }
    }
  });

  if (cluster.isPrimary) {
    const worker = connection.fork("test1", {
      revive: false
    });
  }

  connection.registerCommands(new DemoCommands(connection) as any);

  console.log('Primary Initialized');
}

main();
