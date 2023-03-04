import cluster from 'node:cluster';
import {ClusterfyStorage} from 'clusterfy';
import {cpus} from 'os';
import {Worker} from 'cluster';

console.log('Start clusterfy demo...');

const sharedMemory = new ClusterfyStorage({
    test: 'init'
});
const numCPUs = cpus().length;

if (cluster.isPrimary) {
    const workers: Worker[] = [];

    for (let i = 0; i < numCPUs; i++) {
        const worker = cluster.fork();
        workers.push(worker);
        console.log(`Init worker ${i} with id ${worker.id}`);
    }
    sharedMemory.initAsPrimary(workers);
    setTimeout(() => {
        sharedMemory.sendMessageToWorker(workers[0].id, 'message to worker 1');
    }, 6000);
} else {
    sharedMemory.initAsWorker();

    setTimeout(() => {
        sharedMemory.sendMessageToPrimary('all ok');
    }, 4000);
}
