# Clusterfy

This library simplifies managing processes in a NodeJS cluster. It supports IPC via messaging and a shared storage
managed by the primary process.

<img src="https://raw.githubusercontent.com/julianpoemp/clusterfy/main/docs/images/TerminalDemo.gif" alt="terminal demo gif"/>

For presentation timeouts were inserted. You can find the code to this terminal
preview [here](https://github.com/julianpoemp/clusterfy/blob/main/packages/demo/src/main.ts).

# Features

- Simple API for creating, watching and controlling workers in a cluster.
- Shared storage managed by primary process. Workers can set and retrieve this storage.
- Simple API for sending commands between primary and workers: primary <-> worker or worker <-> worker
- Easy way to add custom commands
- Simple event handling using RxJS (e.g. using Observable)
- Extended workers with more attributes like name and status
- ES Module with Typescript definitions

# How it works

The primary process is the manager who knows everything about the workers and controls these. Furthermore the primary
process manages a shared storage (JS object). If worker want to retrieve or save values to the storage they send
requests to the primary process which returns or saves the value.

Commands from primary process to worker process and vice versa are sent via IPC as ClusterfyIPCEvent objects.
It's also possible to send commands from one worker to another. This works thanks to the primary process that
redirects the messages from one worker to another. With this construct you can send commands asynchronously between
different processes.

# Installation

````
npm install clusterfy --save
````

# Usage

Clusterfy is a static class that can be called everywhere. At the entrypoint of your application you want to start the
cluster.
So you need to initiate the primary process and its workers like that:

````Typescript
import {Clusterfy, ClusterfyIPCEvent, ClusterfyStorage} from 'clusterfy';

async function main() {
    if (Clusterfy.isCurrentProcessPrimary()) {
        // init shared memory
        const sharedMemory = new ClusterfyStorage({
            test: {
                some: 1,
            },
        });
        Clusterfy.init(sharedMemory);

        // create some workers asynchronously
        Clusterfy.fork('SomeName1');
        Clusterfy.fork();
        // now create worker that is revived automatically after it died
        Clusterfy.fork('EmailServer', {revive: true});
        Clusterfy.initAsPrimary();

        // now you can use Clusterfy on primary as you like

        Clusterfy.events.subscribe({
            next: (event: ClusterfyIPCEvent) => {
                console.log(`Primary got event ${event.type} from worker ${event.senderID}`);
            }
        });
    } else {
        await Clusterfy.initAsWorker();
        // worker retrieved metadata from primary on initialization
        console.log(`Worker ${Clusterfy.currentWorker.name} is ready.`);

        // now you can use Clusterfy on worker as you like

        Clusterfy.events.subscribe({
            next: (event: ClusterfyIPCEvent) => {
                console.log(`Worker ${Clusterfy.currentWorker.name} got event ${event.type} from worker ${event.senderID}`);
            }
        });
    }
}

main();

````

## API

### Graceful shutdown

If you call `Clusterfy.shutdownWorker(worker, 2000)` from primary it sends a cy_shutdown command to a worker. The worker
gets status "stopping" and should exit itself using `process.exit(0)` in 2 seconds. If the worker doesn't exit itself,
the primary kill it.

# Development

1. Install dependencies

````
   npm install
````

2. Start in one terminal

````
   npm run watch:lib
````

3. Run demo to test it.

````
   npm run start:demo
 ````
