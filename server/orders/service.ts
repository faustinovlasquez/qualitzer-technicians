import type { Request } from "express";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { OrderAuthorization, type OrderScope } from "./authorization";
import { orderMutationResultSchema, type OrderDeliveryContext } from "./contracts";
import { assertDelivery, assertStart, deliveryContext } from "./rules";
import type { OrderDeliveryInput } from "./validation";

export class OrderService {
  private readonly authorization: OrderAuthorization;
  private readonly mutations = new Set<number>();

  constructor(private readonly upstream: Upstream) { this.authorization = new OrderAuthorization(upstream); }

  async details(req: Request): Promise<OrderDeliveryContext> {
    return deliveryContext(await this.authorization.resolve(req));
  }

  private async mutate(req: Request, validate: (scope: OrderScope) => void, operation: (scope: OrderScope) => Promise<void>): Promise<void> {
    const initial = await this.authorization.resolve(req);
    validate(initial);
    if (this.mutations.has(initial.maintenanceId)) throw new GatewayError(409, "ORDER_MUTATION_IN_PROGRESS");
    this.mutations.add(initial.maintenanceId);
    try {
      const scope = await this.authorization.refresh(req, initial);
      validate(scope);
      await operation(scope);
    } finally { this.mutations.delete(initial.maintenanceId); }
  }

  async start(req: Request): Promise<void> {
    await this.mutate(req, assertStart, async (scope) => {
      parseUpstream(orderMutationResultSchema, await this.upstream.request(`/maintenances/${scope.maintenanceId}/start-repair`, { method: "POST", token: scope.token, json: {} }));
    });
  }

  async deliver(req: Request, input: OrderDeliveryInput): Promise<void> {
    await this.mutate(req, (scope) => assertDelivery(scope, input), async (scope) => {
      parseUpstream(orderMutationResultSchema, await this.upstream.request(`/maintenances/${scope.maintenanceId}/finalize`, {
        method: "POST", token: scope.token,
        json: {
          note: input.note, durationMinutes: input.durationMinutes === 0 ? null : input.durationMinutes,
          faultType: input.faultType, receivedByName: input.receivedByName, clientSignature: input.clientSignature,
          technicianSignature: input.technicianSignature,
        },
      }));
    });
  }
}