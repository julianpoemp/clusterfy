import {Clusterfy, ClusterfyStorage} from 'clusterfy';
import {cpus} from 'os';

const sharedMemory = new ClusterfyStorage({
    test: {
        some: 1
    }
});
Clusterfy.init(sharedMemory);

const numCPUs = cpus().length;

async function main() {
    if (Clusterfy.isCurrentProcessPrimary()) {
        console.log('Start Clusterfy demo...');
        console.log('Primary: Hi workers! Are you ready?')
        Clusterfy.fork('paul');
        Clusterfy.fork('sarah');
        Clusterfy.fork('john');
        Clusterfy.fork('michael');

        setTimeout(async () => {
            try {
                console.log('Primary: Paul, what is the current timestamp?')
                let timestamp = await Clusterfy.runIPCCommand<number>('get_timestamp', [], {
                    name: 'paul'
                });
                console.log(`Worker Paul: ${timestamp}`);
                console.log('Primary: Sarah, what is the current timestamp?')
                timestamp = await Clusterfy.runIPCCommand<number>('get_timestamp', [], {
                    name: 'sarah'
                });
                console.log(`Worker Sarah: ${timestamp}`);
            } catch (e) {
                console.log(`!! ERROR from primary: ${e.message}\n${e.stack}\n----`);
            }
        }, 3000);
        Clusterfy.initAsPrimary();
    } else {
        Clusterfy.initAsWorker();
        setTimeout(async () => {
            try {
                console.log(`Worker ${Clusterfy.currentWorker.name}: I'm ready`);
            } catch (e) {
                console.log(`!! ERROR from worker ${Clusterfy.currentWorker.worker.id}: ${e.message}\n${e.stack}\n----`);
            }
        }, 3000);
    }
}

main();
