import { Global, Module } from "@nestjs/common";
import { EventBusService } from "./event-bus.service.js";

/** Global so any core module can publish platform events via `EventBusService.emitPlatform`. */
@Global()
@Module({
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
