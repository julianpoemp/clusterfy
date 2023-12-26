import {Clusterfy} from "clusterfy";

console.log({
  pid: process.pid,
  ppid: process.ppid
})

Clusterfy.initAsWorker({
  ipc: {
    socket: {
      path: "/tmp/echo11.sock"
    }
  }
});
