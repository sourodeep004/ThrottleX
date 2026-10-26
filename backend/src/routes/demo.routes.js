
import { Router } from "express";
import { rateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

const demoRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 5,
  keyPrefix: "throttlex:demo",
});

router.get("/", demoRateLimit, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Request accepted by ThrottleX",
    data: {
      endpoint: "/api/demo",
      clientIp: req.ip,
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
