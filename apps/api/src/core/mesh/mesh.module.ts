import { Module } from "@nestjs/common";
import { MeshController } from "./mesh.controller.js";
import { MeshService } from "./mesh.service.js";

/** Federated agent mesh (4.6): peer registry + health prober + topology. */
@Module({
  controllers: [MeshController],
  providers: [MeshService],
  exports: [MeshService],
})
export class MeshModule {}
