import {Clusterfy, ClusterfyStorage} from 'clusterfy';
import {cpus} from 'os';

console.log('Start Clusterfy demo...');

const sharedMemory = new ClusterfyStorage({
    test: {
        some: 1
    }
});
Clusterfy.init(sharedMemory);

const numCPUs = cpus().length;

async function main() {
    if (Clusterfy.isCurrentProcessPrimary()) {
        for (let i = 0; i < numCPUs; i++) {
            const worker = Clusterfy.fork('superWorker');
            console.log(`Init worker ${i} with id ${worker.id}`);
        }
        Clusterfy.initAsPrimary();
        setInterval(async () => {
            Clusterfy.outputStatisticsTable();
        }, 1000);
    } else {
        Clusterfy.initAsWorker();
        setTimeout(async () => {
            try {
                let result = await Clusterfy.retrieveFromStorage<number>('test.some');
                await Clusterfy.saveToStorage('test.blubb', Math.floor(Math.random() * 10000));
            } catch (e) {
                console.log(`!! ERROR from worker ${Clusterfy.currentWorker.id}: ${e.message}\n${e.stack}\n----`);
            }
        }, 3000 + Math.floor(Math.random() * 10000));
    }
}

main();
