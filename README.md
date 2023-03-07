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
        // initStorage shared memory
        const sharedMemory = new ClusterfyStorage({
            test: {
                some: 1,
            },
        });
        Clusterfy.initStorage(sharedMemory);

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

## Getter

### currentWorker(): ClusterfyWorker

Returns current worker (only on worker). Returns undefined else.

### storage(): ClusterfyStorage<any>

Returns shared storage (only on primary). Returns undefined else.

### events(): Subject<ClusterfyIPCEvent>

Returns observable of all events to this worker or primary.

### workers(): ClusterfyWorker[]

Returns array of workers (only on primary). Returns empty array else.

## Functions

### initStorage<T>(storage: ClusterfyStorage<T>)

Initializes the storage. Call this method on primary. The storage must be an object, e.g.

````
{
    test: {
        something: 123
    }
}
````

### fork(name?: string, options?: ClusterfyWorkerOptions)

Creates a new worker with given name and options.

#### Options

<table>
<tr>
<td><b>revive</b></td>
<td>If the worker dies because of an error it will be revived.</td>
</tr>
</table>

### initAsPrimary()

Initializes the primary with Clusterfy. This method must be called on primary (see example).

### async initAsWorker()

Initializes the worker with Clusterfy and waits for metadata from primary. This method must be called on worker (see
example). Wait until this method returns

### async saveToStorage(path: string, value: any)

Saves a serializable value to a path in the shared storage on primary. Path should be a string with dot notation to the
attribute , e.g. "test.something". This method returns as soon as saved.

### async retrieveFromStorage&lt;T&gt;(path: string)

Returns a serializable value from a given path in shared storage. Path should be a string with dot notation to the
attribute , e.g. "test.something". This method returns the value of type `T` as soon as retrieved.

### async shutdownWorker(worker: ClusterfyWorker, timeout = 2000)

If you call `Clusterfy.shutdownWorker(worker, 2000)` from primary it sends a cy_shutdown command to a worker. The worker
gets status "STOPPING" and should exit itself using `process.exit(0)` in 2 seconds (graceful shutdown). If the worker
doesn't exit itself,
the primary kill it.

That means: the algorithm you are using for processing in a worker should check if the status is "
STOPPING" using `Clusterfy.currentWorker.status` and then exit itself. The algorithm should also change the status to "
PROCESSING" after it started processing
and change it
back to "IDLE" after finished. If a shutdown is received Clusterfy checks if the status is "IDLE" and
calls `process.exit(0)` or changes the status to "STOPPING".

### getStatistics()

Returns a object with statistics about the workers. Call it on primary.

### outputStatisticsTable()

Outputs statistics from getStatistics to console. Call it on primary.

### registerIPCCommand(command: clusterfyCommand)

Registers a new custom command to the list of supported commands. Call this method on worker and primary.

### changeCurrentWorkerStatus(status: ClusterfyWorkerStatus)

Changes the status of the current worker and emits event of type "status" to itself and to primary.

### exit(code = 0)

Removes event listener of the current process and calls `process.exit(code)`.

## Create custom command

Each command should extend class `ClusterfyCommand`. See examples
in [commands](https://github.com/julianpoemp/clusterfy/tree/main/packages/clusterfy/src/lib/commands).
Call `registerIPCCommand(command)` on primary and worker.

````Typescript
export class ClusterfyCommand {
    name: string;
    target: 'primary' | 'worker';
    runOnTarget: (
        args: Record<string, any>,
        commandEvent?: ClusterfyCommandRequest<any>
    ) => Promise<ClusterfyCommandRequestResult<any>>;

    constructor(options?: Partial<ClusterfyCommand>) {
        if (options) {
            Object.assign(this, options);
        }
    }
}
````

<table>
<tr>
<td><b>name</b></td>
<td>The name of the command in lower case. It should not start with "cy_" because only commands from Clusterfy should be named like that.</td>
</tr>
<tr>
<td><b>target</b></td>
<td>Take "primary" if this command should be run by primary and "worker" otherwise.</td>
</tr>
<tr>
<td><b>runOnTarget</b></td>
<td>method that is run on the target.</td>
</tr>
</table>

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
