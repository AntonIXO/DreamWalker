import type { DreamRoom } from "../../../src/shared/room";
import { addSlot, cloneRoom } from "./box";
import { EXISTING_ROOMS } from "./existing";
import { applyStreetMap } from "./map";
import { M5 } from "./m5-odinochestvo";
import { M6 } from "./m6-krugi";
import { M7 } from "./m7-rm-rf";
import { M8, M8_DEN } from "./m8-5854";
import { M9 } from "./m9-shkaf";
import { M10 } from "./m10-morkovka";
import { M11 } from "./m11-zamok";
import { M12 } from "./m12-nedoliudi";

const NEW_ROOMS: DreamRoom[] = [M5, M6, M7, M8, M8_DEN, M9, M10, M11, M12];

function patchExisting(rooms: DreamRoom[]): DreamRoom[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const courtyard = byId.get("19-dvor-i-oranzhevye-lavochki");
  if (courtyard) addSlot(courtyard, { id: "c", x: 10, y: 7 });
  const hotel = byId.get("01-otel-goticheskii-holl");
  if (hotel) addSlot(hotel, { id: "d", x: 8, y: 7 });
  return rooms;
}

export function allRooms(): DreamRoom[] {
  const existing = EXISTING_ROOMS.map(cloneRoom);
  return applyStreetMap([
    ...patchExisting(existing),
    ...NEW_ROOMS.map(cloneRoom),
  ]);
}
