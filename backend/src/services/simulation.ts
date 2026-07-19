import type { Server } from "socket.io";
import { logger } from "../utils/logger.js";

let simulationInterval: NodeJS.Timeout | null = null;

export function setupLiveSimulation(io: Server): void {
  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    socket.on("start-live", () => {
      if (!simulationInterval) {
        logger.info("Starting live simulation");
        simulationInterval = setInterval(() => {
          const point = {
            id: Math.random().toString(36).substr(2, 9),
            lat: Math.random() * 180 - 90,
            lng: Math.random() * 360 - 180,
            value: Math.floor(Math.random() * 100),
            category: ["Security", "Network", "Auth", "DB"][Math.floor(Math.random() * 4)],
            timestamp: Date.now(),
          };
          io.emit("live-data", point);
        }, 1000);
      }
    });

    socket.on("stop-live", () => {
      logger.info("Stopping live simulation");
      if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
      }
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Client disconnected");
      if (io.engine.clientsCount === 0 && simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
      }
    });
  });
}
