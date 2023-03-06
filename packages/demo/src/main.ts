import { Clusterfy, ClusterfyStorage } from 'clusterfy';
import { cpus } from 'os';
import { filter } from 'rxjs';
import { ClusterfyCommandRequest } from '../../clusterfy/src/lib/types';

const sharedMemory = new ClusterfyStorage({
  test: {
    some: 1,
  },
});
Clusterfy.init(sharedMemory);

const numCPUs = cpus().length;

const wait = async (time: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

async function main() {
  if (Clusterfy.isCurrentProcessPrimary()) {
    console.log('Start Clusterfy demo...');
    console.log('Primary: Hi workers! Are you ready?');
    Clusterfy.fork('Paul');
    Clusterfy.fork('Sarah');
    Clusterfy.fork('John');
    Clusterfy.fork('Michael');

    setTimeout(async () => {
      try {
        console.log('----\nPrimary: Paul, what is the current timestamp?');
        await Clusterfy.runIPCCommand<number>('get_timestamp', [], {
          name: 'Paul',
        });
        await wait(3000);
        console.log(`----\nPrimary: OK, now Sarah what is the timestamp?`);
        await Clusterfy.runIPCCommand<number>('get_timestamp', [], {
          name: 'Sarah',
        });
        await wait(3000);
        console.log(
          `----\nPrimary: OK. Now to all workers: what is the timestamp?`
        );
        Clusterfy.runIPCCommand<number>('get_timestamp', []);
      } catch (e) {
        console.log(`!! ERROR from primary: ${e.message}\n${e.stack}\n----`);
      }
    }, 3000);
    Clusterfy.initAsPrimary();
  } else {
    Clusterfy.initAsWorker();
    Clusterfy.events
      .pipe(
        filter((a) => a.type === 'result' && a.data?.result?.data !== undefined)
      )
      .subscribe({
        next: (event: ClusterfyCommandRequest<any>) => {
          console.log(
            `${Clusterfy.currentWorker.name} (${Clusterfy.currentWorker.worker.id}): ${event?.data?.result?.data}`
          );
        },
      });

    wait(3000).then(async () => {
      if (Clusterfy.currentWorker.name === 'Paul') {
        await wait(10000);

        console.log(`----\nPaul: Hey Sarah, what is the current timestamp?`);
        Clusterfy.runIPCCommand('get_timestamp', undefined, {
          name: 'Sarah',
        });

        await wait(1000);

        console.log(
          `----\nPaul: Hey Primary, please save "Hello world" to attribute "test" in shared storage.`
        );
        await Clusterfy.runIPCCommand('storage_save', {
          path: 'test',
          value: 'Hello world',
        });
        console.log(
          `----\nPaul: Seems saved. Can you please show me the value?`
        );
        const result = await Clusterfy.runIPCCommand('storage_retrieve', {
          path: 'test',
        });
        console.log(`Primary: ${result}`);
      }
      if (Clusterfy.currentWorker.name === 'Sarah') {
        await wait(13000);

        console.log(
          `----\nSarah: After waiting 13 seconds, Primary can you please show me value of test in shared memory?`
        );
        const result = await Clusterfy.runIPCCommand('storage_retrieve', {
          path: 'test',
        });
        console.log(`Primary: ${result}`);
      }
    });
  }
}

main();
