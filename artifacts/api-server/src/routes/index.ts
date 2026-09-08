import { Router, type IRouter } from "express";
import healthRouter from "./health";
import brickkenRouter from "./brickken";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/brickken", brickkenRouter);

export default router;
