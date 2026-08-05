import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module.js";
import { SkillsController } from "./skills.controller.js";
import { SkillService } from "./skill.service.js";

/** Skill marketplace (4.4): catalog + install state backed by the scheduler. */
@Module({
  imports: [EngineModule],
  controllers: [SkillsController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillsModule {}
