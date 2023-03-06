# Clusterfy

This library simplifies managing processes in a NodeJS cluster. It supports IPC via messaging and a shared storage
managed by the primary process.

# Features

- Simple API for creating, watching and controlling workers in a cluster.
- Shared storage managed by primary process
- Simple API for sending commands between primary and workers: primary <-> worker or worker <-> worker
- Easy way to add custom commands
- Simple event handling using RxJS (e.g. using Observable)
- Extended workers with more attributes like name and status
- ES Module with Typescript definitions

# How it works

The primary process is the manager who knows everything about the workers and controls these. Furthermore the primary
process manages a shared storage (JS object). If worker want to retrieve or save values to the storage they send
requests to the primary process which returns or saves the value.

Commands from primary process to worker process and vice versa are sent via IPC as ClusterfyIPCEvent instances.
It's also possible to send commands from one worker to another. This is possible thanks to the primary process that
redirects the messages from one worker to another. With this construct you can send commands asynchronously between different processes.

# Installation

````
npm install clusterfy --save
````

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
