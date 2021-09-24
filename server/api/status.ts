import { getLogger } from '../../logger.js';
import express from "express";
import roommanager from "../roommanager";
import usermanager from '../../usermanager.js';

const router = express.Router();
const log = getLogger("api/status");

router.get("/", (req, res) => {
	res.json({
		status: "ok",
		counters: {
			rooms: roommanager.rooms.length,
		},
	});
});

export default router;