import {Clusterfy, ClusterfyStorage} from 'clusterfy';
import {cpus} from 'os';

console.log('Start Clusterfy demo...');

const sharedMemory = new ClusterfyStorage({
    test: 'init'
});
Clusterfy.init(sharedMemory);

const numCPUs = cpus().length;

if (Clusterfy.isCurrentProcessPrimary()) {
    for (let i = 0; i < numCPUs; i++) {
        const worker = Clusterfy.fork('superWorker');
        console.log(`Init worker ${i} with id ${worker.id}`);
    }
    Clusterfy.initAsPrimary();

    setTimeout(() => {
        Clusterfy.saveToStorage('test', {
            some: 123
        });
        Clusterfy.retrieveFromStorage('test.some');
    }, 3000);
} else {
    Clusterfy.initAsWorker();
}
