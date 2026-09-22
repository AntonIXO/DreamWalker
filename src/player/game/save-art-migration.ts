import type { DreamArtifact } from "../../shared/dream";
import { blockedInRoom, BODY_HEIGHT, BODY_WIDTH } from "../../shared/roomGrid";
import { migrateWorldObjects } from "./object-migration";
import { getActorOccupancy } from "../../shared/world-object";
import type { RunSave } from "./save";
import type { RoomState } from "./world";

/** A known geometry upgrade retains inventory, memories, cycles and door decisions. */
export function migrateArchitectureSave(
  save: RunSave,
  artifact: DreamArtifact,
): void {
  const authored = new Map(artifact.rooms.map((room) => [room.id, room]));
  const previous = new Map(
    save.world.rooms.map((room) => [
      room.id,
      {
        x: room.originX,
        y: room.originY,
        width: room.width,
        height: room.height,
      },
    ]),
  );
  const priorProps = new Map(
    save.world.rooms.flatMap((room) =>
      room.props.map((prop) => [`${room.id}:${prop.id}`, { ...prop }] as const),
    ),
  );
  const newIds = new Set<string>();
  for (const room of save.world.rooms) {
    const next = authored.get(room.id)!;
    const doors = new Map(room.doors.map((door) => [door.id, door]));
    room.originX = next.originX;
    room.originY = next.originY;
    room.width = next.width;
    room.height = next.height;
    room.cells = [...next.cells];
    room.cellVariants = structuredClone(next.cellVariants);
    room.entries = structuredClone(next.entries);
    room.graphics = { ...next.graphics };
    room.tags = [...new Set([...room.tags, ...next.tags])];
    room.doors = next.doors.map((door) => ({
      ...door,
      ...doors.get(door.id),
      x: door.x,
      y: door.y,
      w: door.w,
      h: door.h,
    }));
    room.props = room.props.map((prop) => {
      const replacement = next.props.find(
        (candidate) => candidate.id === prop.id,
      );
      return replacement
        ? {
            ...prop,
            image: replacement.image,
            openImage: replacement.openImage,
            x: replacement.x,
            y: replacement.y,
            w: replacement.w,
            h: replacement.h,
            role: replacement.role,
          }
        : prop;
    });
    for (const prop of next.props) {
      if (
        !prop.id.startsWith("style-") ||
        room.props.some((old) => old.id === prop.id)
      )
        continue;
      room.props.push(structuredClone(prop));
      newIds.add(prop.id);
      const hotspot = next.hotspots.find((spot) => spot.propId === prop.id);
      if (hotspot) room.hotspots.push(structuredClone(hotspot));
    }
  }
  const byId = new Map(save.world.rooms.map((room) => [room.id, room]));
  const authoredObjects = migrateWorldObjects(artifact.rooms);
  for (const list of [save.world.objects, save.world.baseObjects]) {
    for (const object of authoredObjects) {
      if (newIds.has(object.id) && !list.some((old) => old.id === object.id))
        list.push(structuredClone(object));
    }
  }
  const desired = new Map(
    authoredObjects.map((object) => [object.id, object.location]),
  );
  const images = new Map(
    authoredObjects.map((object) => [object.id, object.visual]),
  );
  const bodies = new Map(
    authoredObjects.map((object) => [object.id, object.body]),
  );
  for (const object of [...save.world.objects, ...save.world.baseObjects]) {
    const visual = images.get(object.id);
    if (visual) object.visual = { ...visual };
    const body = bodies.get(object.id);
    if (body && object.body) {
      if (
        object.location.kind === "room" &&
        !byId.get(object.location.roomId)?.tags.includes("route")
      ) {
        const target = desired.get(object.id);
        const localId = object.id.startsWith(`${object.location.roomId}:`)
          ? object.id.slice(object.location.roomId.length + 1)
          : object.id;
        const previousProp = priorProps.get(
          `${object.location.roomId}:${localId}`,
        );
        if (
          target?.kind === "room" &&
          target.roomId === object.location.roomId &&
          previousProp &&
          object.location.x === previousProp.x &&
          object.location.y === previousProp.y
        ) {
          object.location.x = target.x;
          object.location.y = target.y;
        } else {
          object.location.x += (object.body.w - body.w) / 2;
          object.location.y += object.body.h - body.h;
        }
      }
      object.body.w = body.w;
      object.body.h = body.h;
    }
  }
  const nearest = (
    room: RoomState,
    x: number,
    y: number,
    ignoreId?: string,
    width = BODY_WIDTH,
    height = BODY_HEIGHT,
  ): { x: number; y: number } => {
    const objectIds = new Set(save.world.objects.map((object) => object.id));
    const solids = [
      ...room.props.filter(
        (prop) =>
          !objectIds.has(prop.id) && !objectIds.has(`${room.id}:${prop.id}`),
      ),
      ...save.world.objects.flatMap((object) =>
        object.id !== ignoreId &&
        object.location.kind === "room" &&
        object.location.roomId === room.id &&
        object.body?.solid
          ? [{ x: object.location.x, y: object.location.y, ...object.body }]
          : [],
      ),
    ];
    const fits = (tx: number, ty: number): boolean =>
      !blockedInRoom(
        room,
        solids,
        {
          x: tx * room.tileSize,
          y: ty * room.tileSize,
          width,
          height,
        },
        room.tileSize,
      );
    if (fits(x, y)) return { x, y };
    let best = { x: room.entries[0]!.x, y: room.entries[0]!.y };
    let distance = Infinity;
    for (let ty = height / room.tileSize / 2; ty < room.height; ty++)
      for (let tx = width / room.tileSize / 2; tx < room.width; tx++) {
        const d = (tx - x) ** 2 + (ty - y) ** 2;
        if (d < distance && fits(tx, ty)) {
          best = { x: tx, y: ty };
          distance = d;
        }
      }
    return best;
  };
  const translateLocal = (
    room: RoomState,
    x: number,
    y: number,
    ignoreId?: string,
  ) => {
    const old = previous.get(room.id)!;
    return nearest(
      room,
      (x * room.width) / old.width,
      (y * room.height) / old.height,
      ignoreId,
    );
  };
  for (const object of [...save.world.objects, ...save.world.baseObjects]) {
    if (object.location.kind !== "room" || !object.body) continue;
    const home = byId.get(object.location.roomId);
    if (!home?.tags.includes("route")) continue;
    const old = previous.get(home.id)!;
    const { w, h } = object.body;
    const point = nearest(
      home,
      (object.location.x * home.width) / old.width + w / 2,
      (object.location.y * home.height) / old.height + h / 2,
      object.id,
      w * home.tileSize,
      h * home.tileSize,
    );
    object.location.x = point.x - w / 2;
    object.location.y = point.y - h / 2;
  }
  const room = byId.get(save.world.currentRoomId)!;
  const old = previous.get(room.id)!;
  const player = save.session.player;
  const local = translateLocal(
    room,
    player.x / room.tileSize - old.x,
    player.y / room.tileSize - old.y,
    getActorOccupancy(save.world.objects, { kind: "player" })?.id,
  );
  player.x = (room.originX + local.x) * room.tileSize;
  player.y = (room.originY + local.y) * room.tileSize;
  player.moving = false;
  player.enteredDoorId = null;
  player.refusedDoorId = null;
  for (const figure of [...save.world.figures, ...save.world.baseFigures]) {
    const home = byId.get(figure.roomId);
    if (!home) continue;
    Object.assign(
      figure,
      translateLocal(
        home,
        figure.x,
        figure.y,
        getActorOccupancy(save.world.objects, { kind: "figure", id: figure.id })
          ?.id,
      ),
    );
    figure.targetX = null;
    figure.targetY = null;
    figure.walking = false;
  }
}
