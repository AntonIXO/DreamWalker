import type { DreamRoom } from "../../../src/shared/room";
import { addDoor, addSlot, cloneRoom, rift } from "./box";
import { EXISTING_ROOMS } from "./existing";
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
  if (courtyard) {
    addSlot(courtyard, { id: "c", x: 10, y: 7 });
    addDoor(
      courtyard,
      rift({
        id: "19-dvor-i-oranzhevye-lavochki--rift-m11",
        x: 5,
        toRoomId: "m11-zamok-po-vremeni",
        prompt: "трещина в плитке",
      }),
    );
    addDoor(
      courtyard,
      rift({
        id: "19-dvor-i-oranzhevye-lavochki--rift-m5",
        x: 7,
        toRoomId: "m5-odinochestvo",
        prompt: "пустой файл",
      }),
    );
  }

  const school = byId.get("02-shkola-kabinet-russkogo");
  if (school) {
    addDoor(
      school,
      rift({
        id: "02-shkola-kabinet-russkogo--rift-m6",
        x: 5,
        toRoomId: "m6-krugi-vokrug-pruda",
        prompt: "окно во двор",
      }),
    );
    addDoor(
      school,
      rift({
        id: "02-shkola-kabinet-russkogo--rift-m9",
        x: 7,
        toRoomId: "m9-shkaf",
        prompt: "шкаф в коридоре",
      }),
    );
  }

  const hotel = byId.get("01-otel-goticheskii-holl");
  if (hotel) {
    addSlot(hotel, { id: "d", x: 8, y: 7 });
  }

  const shop = byId.get("05-shesterochka");
  if (shop) {
    addDoor(
      shop,
      rift({
        id: "05-shesterochka--rift-m7",
        x: 17,
        toRoomId: "m7-rm-rf",
        prompt: "полка, которая длиннее зала",
      }),
    );
  }

  const apartment = byId.get("08-kvartira-v-kotoroi-zhivut-drugie");
  if (apartment) {
    addDoor(
      apartment,
      rift({
        id: "08-kvartira-v-kotoroi-zhivut-drugie--rift-m8",
        x: 17,
        toRoomId: "m8-5854",
        prompt: "дверь, которой не было",
      }),
    );
  }

  const clinic = byId.get("14-poliklinika-v-kaluge");
  if (clinic) {
    addDoor(
      clinic,
      rift({
        id: "14-poliklinika-v-kaluge--rift-m10",
        x: 17,
        toRoomId: "m10-zamorozhennaia-morkovka",
        prompt: "ящик стола",
      }),
    );
  }

  const hackathon = byId.get("09-hakaton-tretii-po-schetu");
  if (hackathon) {
    addDoor(
      hackathon,
      rift({
        id: "09-hakaton-tretii-po-schetu--rift-m12",
        x: 17,
        toRoomId: "m12-nedoliudi",
        prompt: "созвон в соседней комнате",
      }),
    );
  }

  return rooms;
}

export function allRooms(): DreamRoom[] {
  const existing = EXISTING_ROOMS.map(cloneRoom);
  return [...patchExisting(existing), ...NEW_ROOMS.map(cloneRoom)];
}
