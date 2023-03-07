import { Clusterfy, ClusterfyIPCEvent, ClusterfyStorage } from 'clusterfy';
import * as _cluster from 'cluster';

const cluster = _cluster as unknown as _cluster.Cluster;

const wait = async (time: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

async function main() {
  if (Clusterfy.isCurrentProcessPrimary()) {
    const sharedMemory = new ClusterfyStorage({
      test: {
        some: 1,
      },
    });
    Clusterfy.init(sharedMemory);

    console.log('Start Clusterfy demo...');
    console.log('Primary: Hi workers! Are you ready?');

    const paul = Clusterfy.fork('Paul');
    const sarah = Clusterfy.fork('Sarah');
    const john = Clusterfy.fork('John', { revive: true });
    const michael = Clusterfy.fork('Michael');
    Clusterfy.initAsPrimary();

    Clusterfy.events.subscribe({
      next: (event) => {
        //console.log(`Primary got event ${event.type} from ${event.senderID}`);
      },
    });

    setTimeout(async () => {
      try {
        console.log('----\nPrimary: Paul, what is the current timestamp?');
        await Clusterfy.runIPCCommand<number>('cy_get_timestamp', [], {
          name: 'Paul',
        });
        await wait(3000);
        console.log(`----\nPrimary: OK, now Sarah what is the timestamp?`);
        await Clusterfy.runIPCCommand<number>('cy_get_timestamp', [], {
          name: 'Sarah',
        });
        await wait(3000);
        console.log(
          `----\nPrimary: OK. Now to all workers: what is the timestamp?`
        );
        await Clusterfy.runIPCCommand<number>('cy_get_timestamp', []);
        console.log('Shutdown all gracefully...');
        await Clusterfy.shutdownWorker(michael);
        await Clusterfy.shutdownWorker(paul);
        await Clusterfy.shutdownWorker(sarah);
        await Clusterfy.shutdownWorker(john);
        console.log(
          `Running workers: ${Clusterfy.getStatistics().workersOnline}`
        );
      } catch (e) {
        console.log(`!! ERROR from primary: ${e.message}\n${e.stack}\n----`);
      }
    }, 3000);
  } else {
    await Clusterfy.initAsWorker();
    console.log(`Worker ${Clusterfy.currentWorker.name}: I'm ready`);

    Clusterfy.events.subscribe({
      next: (event: ClusterfyIPCEvent) => {
        if (event.type === 'result' && event?.data?.result !== undefined) {
          // output result to console
          console.log(
            `Worker ${Clusterfy.currentWorker.name} (${Clusterfy.currentWorker.worker.id}): ${event?.data?.result?.data}`
          );
        } else if (event.type !== 'command') {
          console.log(
            ` -> Worker ${Clusterfy.currentWorker.name} (${Clusterfy.currentWorker.worker.id}) emitted event ${event.type}`
          );
        }
      },
    });

    if (Clusterfy.currentWorker.name === 'Paul') {
      await wait(10000);

      console.log(
        `----\nWorker Paul: Hey Sarah, what is the current timestamp?`
      );
      Clusterfy.runIPCCommand('cy_get_timestamp', undefined, {
        name: 'Sarah',
      });

      await wait(1000);

      console.log(
        `----\nWorker Paul: Hey Primary, please save "Hello World!" to attribute "test" in shared storage.`
      );
      await Clusterfy.saveToStorage('test', 'Hello World!');
      console.log(
        `----\nWorker Paul: No error returned, that's good. Can you please show me the value?`
      );
      const result = await Clusterfy.retrieveFromStorage<string>('test');
      console.log(`Primary: ${result}`);
    }
    if (Clusterfy.currentWorker.name === 'Sarah') {
      await wait(13000);

      console.log(
        `----\nWorker Sarah: After waiting 13 seconds, Primary can you please show me value of test in shared memory?`
      );
      const result = await Clusterfy.runIPCCommand('storage_retrieve', {
        path: 'test',
      });
      console.log(`Primary: ${result}`);
    }
  }
}

main();
