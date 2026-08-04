import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from "./workflow.schema.js";

/**
 * Phase 3.0 — CRUD for stored workflow definitions. Same degradation pattern
 * as TaskService: every read/write checks `this.prisma.db` and degrades
 * gracefully (null / [] / a clear error) when there is no database.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: { name: string; description?: string; definition: unknown }) {
    const db = this.prisma.db;
    if (!db) throw new Error("Database not available");
    const error = validateWorkflowDefinition(input.definition);
    if (error) throw new BadRequestException(`Invalid workflow definition: ${error}`);
    return db.workflow.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        definition: input.definition as object,
      },
    });
  }

  async findAll() {
    const db = this.prisma.db;
    if (!db) return [];
    return db.workflow.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const db = this.prisma.db;
    if (!db) return null;
    return db.workflow.findUnique({
      where: { id },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 10 } },
    });
  }

  async update(id: string, input: { name?: string; description?: string; definition?: unknown }) {
    const db = this.prisma.db;
    if (!db) throw new Error("Database not available");
    const existing = await db.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Workflow "${id}" not found`);
    if (input.definition !== undefined) {
      const error = validateWorkflowDefinition(input.definition);
      if (error) throw new BadRequestException(`Invalid workflow definition: ${error}`);
    }
    return db.workflow.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.definition !== undefined ? { definition: input.definition as object } : {}),
      },
    });
  }

  async remove(id: string): Promise<boolean> {
    const db = this.prisma.db;
    if (!db) return false;
    const existing = await db.workflow.findUnique({ where: { id } });
    if (!existing) return false;
    await db.workflow.delete({ where: { id } });
    return true;
  }

  /** Load + validate a definition for the executor; throws with a clear message. */
  async getValidated(id: string): Promise<{ workflowId: string; name: string; definition: WorkflowDefinition }> {
    const row = await this.findOne(id);
    if (!row) throw new NotFoundException(`Workflow "${id}" not found`);
    const error = validateWorkflowDefinition(row.definition);
    if (error) throw new BadRequestException(`Workflow "${id}" is invalid: ${error}`);
    return {
      workflowId: row.id,
      name: row.name,
      definition: row.definition as unknown as WorkflowDefinition,
    };
  }
}
