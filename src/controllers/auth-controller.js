import { readJsonBody, sendJson } from "../utils/http.js";

export class AuthController {
  constructor(authService) {
    this.authService = authService;
  }

  async login(req, res) {
    const body = await readJsonBody(req);
    const user = await this.authService.loginByPhone(body);
    sendJson(res, 200, user);
  }
}
