# Clusterfy

This library simplifies managing processes in a NodeJS cluster. It supports IPC via messaging and a shared storage
managed by the primary process.

# Features

- Simple API for creating, watching and controlling workers in a cluster.
- Shared storage managed by primary process
- Simple API for sending commands between primary and workers
- Simple event handling using RxJS (e.g. using Observable)
- Extended workers with more attributes like name and status
- ES Module with Typescript definitions
- Small library ~210 Bytes

# How it works

The primary process is the manager who knows everything about the workers and controls these. Further more the primary
process
manages a shared storage that is a JS object. If worker want to retrieve or save values to the storage they send
requests to the primary process which returns or saves the value.

Commands from primary process to worker process and vice versa are sent via IPC as ClusterfyIPCEvent instances. With
this construct you can send commands asynchronously between different processes.

# Installation

````
npm install clusterfy --save
````

# Development
