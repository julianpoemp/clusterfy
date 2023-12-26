import {
  Clusterfy,
  ClusterfyIPCEvent,
  ClusterfyIPCMethod,
  ClusterfyStorage,
} from 'clusterfy';
import * as _cluster from 'cluster';

const cluster = _cluster as unknown as _cluster.Cluster;

const wait = async (time: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const onShutdown = async () => {
  console.log(`${Clusterfy.currentLabel}: Simulate cleanup on shutdown...`);

  let j = 0;
  for (let i = 0; i < 100000; i++) {
    j++;
  }
  console.log(`${Clusterfy.currentLabel}: All cleaned up.`);
};

async function main() {
  if (Clusterfy.isCurrentProcessPrimary()) {
    const sharedMemory = new ClusterfyStorage({
      test: {
        some: 1,
      },
    });
    Clusterfy.initStorage(sharedMemory);

    console.log('Start Clusterfy demo...');
    console.log(
      `${Clusterfy.currentLabel}: Create Workers Paul, Sarah, John, Michael...`
    );

    const paul = Clusterfy.fork('Paul');
    const sarah = Clusterfy.fork('Sarah');
    const john = Clusterfy.fork('John', { revive: true });
    const michael = Clusterfy.fork('Michael');

    await Clusterfy.initAsPrimary({
      shutdown: {
        gracefulOnSignals: ['SIGINT', 'SIGTERM'],
      }
    });
    console.log("Primary Initialized");
    Clusterfy.registerShutdownMethod('default', onShutdown);
    console.log(`${Clusterfy.currentLabel}: Worker created.`);

    try {
      console.log(
        `----\n${Clusterfy.currentLabel}: Paul, what is the current timestamp?`
      );
      await Clusterfy.runIPCCommand<number>('cy_get_timestamp', [], {
        name: 'Paul',
      });
      await wait(3000);
      console.log(
        `----\n${Clusterfy.currentLabel}: OK, now Sarah what is the timestamp?`
      );
      await Clusterfy.runIPCCommand<number>('cy_get_timestamp', [], {
        name: 'Sarah',
      });
      await wait(3000);
      console.log(
        `----\n${Clusterfy.currentLabel}: OK. Now to all workers: what is the timestamp?`
      );
      await Clusterfy.runIPCCommand<number>('cy_get_timestamp', []);

      await wait(10000);
      console.log('----\nPrimary: Shutdown all gracefully...');
      await Clusterfy.shutdownWorker(michael);
      await Clusterfy.shutdownWorker(paul);
      await Clusterfy.shutdownWorker(sarah);
      await Clusterfy.shutdownWorker(john);

      console.log(
        `Running workers: ${Clusterfy.getStatistics().workersOnline}`
      );
      process.exit(0);
    } catch (e) {
      console.log(`!! ERROR from primary: ${e.message}\n${e.stack}\n----`);
    }
  } else {
    console.log({
    pid: process.pid,
    ppid: process.ppid
  })
    Clusterfy.events.subscribe({
      next: (event: ClusterfyIPCEvent) => {
        if (Clusterfy.currentWorker?.name) {
          if (event.type === 'result' && event?.data?.result !== undefined) {
            // output result to console
            console.log(
              `${Clusterfy.currentLabel}: ${event?.data?.result?.data}`
            );
          } else if (!['command', 'ready'].includes(event.type)) {
            console.log(
              ` -> ${Clusterfy.currentLabel} changed his/her status from ${event.data?.oldStatus} to ${event.data?.newStatus}`
            );
          }
        }
      },
    });

    await Clusterfy.initAsWorker(ClusterfyIPCMethod.message, {
      shutdown: {
        gracefulOnSignals: ['SIGINT', 'SIGTERM'],
      }
    });
    Clusterfy.registerShutdownMethod('default', onShutdown);

    if (Clusterfy.currentWorker.name === 'Paul') {
      await wait(10000);

      console.log(
        `----\n${Clusterfy.currentLabel}: Hey Sarah, what is the current timestamp?`
      );
      Clusterfy.runIPCCommand('cy_get_timestamp', undefined, {
        name: 'Sarah',
      });

      await wait(1000);

      console.log(
        `----\n${Clusterfy.currentLabel}: Hey Primary, please save "Hello World!" to attribute "test" in shared storage.`
      );
      await Clusterfy.saveToStorage('test', 'Hello World!');
      console.log(
        `----\n${Clusterfy.currentLabel}: No error returned, that's good. Can you please show me the value?`
      );
      const result = await Clusterfy.retrieveFromStorage<string>('test');
      console.log(`Primary: ${result}`);
    }
    if (Clusterfy.currentWorker.name === 'Sarah') {
      await wait(13000);

      console.log(
        `----\n${Clusterfy.currentLabel}: After waiting 13 seconds, Primary can you please show me value of test in shared memory?`
      );
      const result = await Clusterfy.runIPCCommand('cy_storage_retrieve', {
        path: 'test',
      });
      console.log(`Primary: ${result}`);
    }
  }
}

main();
