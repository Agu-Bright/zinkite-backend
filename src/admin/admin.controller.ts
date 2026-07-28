/**
 * Admin Controller
 * Handles all admin-only endpoints
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { Types } from "mongoose";

function validateObjectId(id: string, label = 'id'): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException(`Invalid ${label}: must be a valid MongoDB ObjectId`);
  }
}
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { GiftCardsService } from "../giftcards/giftcards.service";
import { SettingsService } from "../settings/settings.service";
import { BulkUpdateSettingsDto } from "../settings/dto";
import {
  ManualWalletAdjustmentDto,
  UsersQueryDto,
  UpdateUserStatusDto,
  PaystackQueryDto,
  DashboardStatsResponse,
  WithdrawalsQueryDto,
  CreditRequestsQueryDto,
  CreateCreditRequestDto,
  DenyCreditRequestDto,
  SendNotificationDto,
  NotificationsQueryDto,
  DeleteTransactionDto,
} from "./dto";
import {
  CreateBrandDto,
  UpdateBrandDto,
  BrandQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  CreateRateDto,
  UpdateRateDto,
  RateQueryDto,
  ReviewTradeDto,
  TradeQueryDto,
  MakeOfferDto,
} from "../giftcards/dto";
import {
  TradeStatus,
  TradeType,
} from "../giftcards/schemas/gift-card-trade.schema";
import { TransactionsQueryDto } from "../wallet/dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, Roles } from "../common/decorators";
import { JwtPayload } from "../auth/strategies/jwt.strategy";
import { ProviderHealthService } from "./provider-health.service";
import { PermissionsGuard } from "./guards/permissions.guard";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "./decorators/require-permissions.decorator";

@ApiTags("Admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("ADMIN")
@ApiBearerAuth("JWT-auth")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly giftCardsService: GiftCardsService,
    private readonly providerHealthService: ProviderHealthService,
    private readonly settingsService: SettingsService,
  ) {}

  // ============================================
  // DASHBOARD
  // ============================================

  @Get("dashboard/stats")
  @RequirePermissions("dashboard.view")
  @ApiOperation({ summary: "Get admin dashboard statistics" })
  @ApiResponse({
    status: 200,
    description: "Dashboard statistics",
    type: DashboardStatsResponse,
  })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get("dashboard/recent")
  @RequirePermissions("dashboard.view")
  @ApiOperation({ summary: "Get recent activity for dashboard" })
  @ApiResponse({
    status: 200,
    description: "Recent trades and transactions",
  })
  async getDashboardRecent() {
    return this.adminService.getDashboardRecent();
  }

  // ============================================
  // USER MANAGEMENT
  // ============================================

  @Get("users")
  @RequirePermissions("users.view")
  @ApiOperation({ summary: "Get all users with filters" })
  @ApiResponse({ status: 200, description: "Paginated list of users" })
  async getUsers(@Query() query: UsersQueryDto) {
    return this.adminService.getUsers(query);
  }

  @Get("users/:id")
  @RequirePermissions("users.view")
  @ApiOperation({ summary: "Get user details by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: 200,
    description: "User details with wallet and stats",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async getUserById(@Param("id") id: string) {
    validateObjectId(id, 'user id');
    return this.adminService.getUserById(id);
  }

  @Patch("users/:id/status")
  @RequireAnyPermission("users.suspend", "users.ban")
  @ApiOperation({ summary: "Update user status (suspend/reactivate)" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: 200, description: "User status updated" })
  @ApiResponse({ status: 404, description: "User not found" })
  async updateUserStatus(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: UpdateUserStatusDto,
  ) {
    validateObjectId(id, 'user id');
    return this.adminService.updateUserStatus(id, admin.sub, dto);
  }

  @Get("users/:id/transactions")
  @RequireAnyPermission("users.view", "transactions.view")
  @ApiOperation({ summary: "Get wallet transactions for a specific user" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: 200, description: "Paginated wallet transactions" })
  async getUserTransactions(
    @Param("id") id: string,
    @Query() query: TransactionsQueryDto,
  ) {
    validateObjectId(id, 'user id');
    return this.adminService.getUserWalletTransactions(id, query);
  }

  @Get("users/:id/trades")
  @RequirePermissions("users.view")
  @ApiOperation({ summary: "Get gift card trades for a specific user" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({ status: 200, description: "Paginated gift card trades" })
  async getUserTrades(
    @Param("id") id: string,
    @Query() query: TradeQueryDto,
  ) {
    validateObjectId(id, "user id");
    return this.adminService.getTrades({ ...query, userId: id });
  }

  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  @Get("wallet/transactions")
  @RequirePermissions("transactions.view")
  @ApiOperation({ summary: "Get all wallet transactions" })
  @ApiResponse({ status: 200, description: "Paginated wallet transactions" })
  async getWalletTransactions(@Query() query: TransactionsQueryDto) {
    return this.adminService.getAllWalletTransactions(query);
  }

  @Get("wallet/transactions/:id")
  @RequirePermissions("transactions.view")
  @ApiOperation({ summary: "Get single wallet transaction details" })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Wallet transaction details" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getWalletTransaction(@Param("id") id: string) {
    validateObjectId(id, "transaction id");
    return this.adminService.getWalletTransactionById(id);
  }

  @Patch("wallet/transactions/:id/delete")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("transactions.delete")
  @ApiOperation({
    summary:
      "Remove a transaction from histories without changing the wallet balance",
  })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Transaction removed" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async deleteWalletTransaction(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: DeleteTransactionDto,
  ) {
    validateObjectId(id, "transaction id");
    return this.adminService.deleteWalletTransaction(id, admin.sub, dto);
  }

  @Post("wallet/adjustment")
  @RequireAnyPermission("wallet.credit", "wallet.debit")
  @ApiOperation({ summary: "Manual wallet credit/debit adjustment" })
  @ApiResponse({ status: 201, description: "Adjustment completed" })
  @ApiResponse({ status: 404, description: "User not found" })
  async manualWalletAdjustment(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ManualWalletAdjustmentDto,
  ) {
    return this.adminService.manualWalletAdjustment(admin.sub, dto);
  }

  // ============================================
  // GIFT CARD BRAND MANAGEMENT
  // ============================================

  @Get("giftcards/brands")
  @RequireAnyPermission(
    "giftcards.brands.view",
    "giftcards.rates.update",
    "giftcards.rates.manage",
  )
  @ApiOperation({ summary: "Get all brands (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of brands" })
  async getBrands(@Query() query: BrandQueryDto) {
    return this.giftCardsService.getBrands(query);
  }

  @Post("giftcards/brands")
  @RequirePermissions("giftcards.brands.manage")
  @ApiOperation({ summary: "Create a new brand" })
  @ApiResponse({ status: 201, description: "Brand created" })
  @ApiResponse({ status: 409, description: "Brand already exists" })
  async createBrand(@Body() dto: CreateBrandDto) {
    return this.giftCardsService.createBrand(dto);
  }

  @Put("giftcards/brands/:id")
  @RequirePermissions("giftcards.brands.manage")
  @ApiOperation({ summary: "Update a brand" })
  @ApiParam({ name: "id", description: "Brand ID" })
  @ApiResponse({ status: 200, description: "Brand updated" })
  @ApiResponse({ status: 404, description: "Brand not found" })
  async updateBrand(@Param("id") id: string, @Body() dto: UpdateBrandDto) {
    return this.giftCardsService.updateBrand(id, dto);
  }

  @Delete("giftcards/brands/:id")
  @RequirePermissions("giftcards.brands.manage")
  @ApiOperation({ summary: "Delete a brand (soft-delete)" })
  @ApiParam({ name: "id", description: "Brand ID" })
  @ApiResponse({ status: 200, description: "Brand deleted" })
  @ApiResponse({ status: 404, description: "Brand not found" })
  async deleteBrand(@Param("id") id: string) {
    return this.giftCardsService.deleteBrand(id);
  }

  // ============================================
  // GIFT CARD CATEGORY MANAGEMENT
  // ============================================

  @Get("giftcards/categories")
  @RequireAnyPermission(
    "giftcards.brands.view",
    "giftcards.rates.update",
    "giftcards.rates.manage",
  )
  @ApiOperation({ summary: "Get all categories (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of categories" })
  async getCategories(@Query() query: CategoryQueryDto) {
    return this.giftCardsService.getCategories(query);
  }

  @Post("giftcards/categories")
  @RequirePermissions("giftcards.brands.manage")
  @ApiOperation({ summary: "Create a new category" })
  @ApiResponse({ status: 201, description: "Category created" })
  @ApiResponse({ status: 404, description: "Brand not found" })
  @ApiResponse({ status: 409, description: "Category slug already exists" })
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.giftCardsService.createCategory(dto);
  }

  @Put("giftcards/categories/:id")
  @RequirePermissions("giftcards.brands.manage")
  @ApiOperation({ summary: "Update a category" })
  @ApiParam({ name: "id", description: "Category ID" })
  @ApiResponse({ status: 200, description: "Category updated" })
  @ApiResponse({ status: 404, description: "Category not found" })
  async updateCategory(
    @Param("id") id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.giftCardsService.updateCategory(id, dto);
  }

  @Delete("giftcards/categories/:id")
  @RequirePermissions("giftcards.brands.manage")
  @ApiOperation({ summary: "Delete a category (soft-delete)" })
  @ApiParam({ name: "id", description: "Category ID" })
  @ApiResponse({ status: 200, description: "Category deleted" })
  @ApiResponse({ status: 404, description: "Category not found" })
  async deleteCategory(@Param("id") id: string) {
    return this.giftCardsService.deleteCategory(id);
  }

  // ============================================
  // GIFT CARD RATE MANAGEMENT
  // ============================================

  @Get("giftcards/rates")
  @RequireAnyPermission(
    "giftcards.rates.view",
    "giftcards.rates.update",
    "giftcards.rates.manage",
  )
  @ApiOperation({ summary: "Get all rates (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of rates" })
  async getRates(@Query() query: RateQueryDto) {
    return this.giftCardsService.getRates(query);
  }

  @Post("giftcards/rates")
  @RequirePermissions("giftcards.rates.manage")
  @ApiOperation({ summary: "Create a new rate" })
  @ApiResponse({ status: 201, description: "Rate created" })
  @ApiResponse({ status: 404, description: "Category not found" })
  @ApiResponse({ status: 409, description: "Overlapping rate range exists" })
  async createRate(@Body() dto: CreateRateDto) {
    return this.giftCardsService.createRate(dto);
  }

  @Put("giftcards/rates/:id")
  @RequireAnyPermission("giftcards.rates.update", "giftcards.rates.manage")
  @ApiOperation({ summary: "Update a rate" })
  @ApiParam({ name: "id", description: "Rate ID" })
  @ApiResponse({ status: 200, description: "Rate updated" })
  @ApiResponse({ status: 404, description: "Rate not found" })
  async updateRate(@Param("id") id: string, @Body() dto: UpdateRateDto) {
    return this.giftCardsService.updateRate(id, dto);
  }

  @Delete("giftcards/rates/:id")
  @RequirePermissions("giftcards.rates.manage")
  @ApiOperation({ summary: "Delete a rate (soft-delete)" })
  @ApiParam({ name: "id", description: "Rate ID" })
  @ApiResponse({ status: 200, description: "Rate deleted" })
  @ApiResponse({ status: 404, description: "Rate not found" })
  async deleteRate(@Param("id") id: string) {
    return this.giftCardsService.deleteRate(id);
  }

  // ============================================
  // GIFT CARD TRADE MANAGEMENT
  // ============================================

  @Get("giftcards/trades")
  @RequireAnyPermission(
    "giftcards.trades.view",
    "giftcards.lost-digits.view",
    "giftcards.lost-digits.manage",
  )
  @ApiOperation({ summary: "Get all trades (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated list of trades" })
  async getTrades(
    @Query() query: TradeQueryDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const permissions = admin.permissions || [];
    const hasAllTrades = permissions.includes("giftcards.trades.view");
    return this.adminService.getTrades(
      hasAllTrades ? query : { ...query, tradeType: TradeType.LOST_DIGITS },
    );
  }

  @Get("giftcards/trades/stats")
  @RequirePermissions("giftcards.trades.view")
  @ApiOperation({ summary: "Get trade statistics" })
  @ApiResponse({ status: 200, description: "Trade statistics" })
  async getTradeStats() {
    return this.adminService.getTradeStats();
  }

  @Get("giftcards/trades/:id")
  @RequireAnyPermission(
    "giftcards.trades.view",
    "giftcards.lost-digits.view",
    "giftcards.lost-digits.manage",
  )
  @ApiOperation({ summary: "Get trade details by ID" })
  @ApiParam({ name: "id", description: "Trade ID" })
  @ApiResponse({ status: 200, description: "Trade details" })
  @ApiResponse({ status: 404, description: "Trade not found" })
  async getTradeById(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
  ) {
    const trade = await this.adminService.getTradeById(id);
    if (
      !(admin.permissions || []).includes("giftcards.trades.view") &&
      trade.tradeType !== TradeType.LOST_DIGITS
    ) {
      throw new ForbiddenException("You can only access missing-code trades");
    }
    return trade;
  }

  @Post("giftcards/trades/:id/review")
  @RequireAnyPermission(
    "giftcards.trades.approve",
    "giftcards.trades.reject",
    "giftcards.lost-digits.manage",
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Review/approve/reject a trade" })
  @ApiParam({ name: "id", description: "Trade ID" })
  @ApiResponse({ status: 200, description: "Trade reviewed" })
  @ApiResponse({ status: 400, description: "Invalid review action" })
  @ApiResponse({ status: 404, description: "Trade not found" })
  async reviewTrade(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: ReviewTradeDto,
  ) {
    const trade = await this.adminService.getTradeById(id);
    const permissions = admin.permissions || [];
    if (trade.tradeType === TradeType.LOST_DIGITS) {
      if (!permissions.includes("giftcards.lost-digits.manage")) {
        throw new ForbiddenException("Missing-code trade permission required");
      }
    } else if (
      dto.status === TradeStatus.APPROVED &&
      !permissions.includes("giftcards.trades.approve")
    ) {
      throw new ForbiddenException("Trade approval permission required");
    } else if (
      dto.status === TradeStatus.REJECTED &&
      !permissions.includes("giftcards.trades.reject")
    ) {
      throw new ForbiddenException("Trade rejection permission required");
    }
    return this.adminService.reviewTrade(id, admin.sub, dto);
  }

  @Patch("giftcards/trades/:id/offer")
  @RequirePermissions("giftcards.lost-digits.manage")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Make an offer on a LOST_DIGITS trade (admin proposes payout)",
  })
  @ApiParam({ name: "id", description: "Trade ID" })
  @ApiResponse({ status: 200, description: "Offer sent to user" })
  @ApiResponse({ status: 400, description: "Trade is not eligible for an offer" })
  @ApiResponse({ status: 404, description: "Trade not found" })
  async makeOffer(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: MakeOfferDto,
  ) {
    return this.adminService.makeOffer(id, admin.sub, dto);
  }

  // ============================================
  // PAYSTACK MANAGEMENT
  // ============================================

  @Get("paystack/transactions")
  @RequirePermissions("topups.view")
  @ApiOperation({ summary: "Get Paystack transactions" })
  @ApiResponse({ status: 200, description: "Paginated Paystack transactions" })
  async getPaystackTransactions(@Query() query: PaystackQueryDto) {
    return this.adminService.getPaystackTransactions(query);
  }

  @Get("paystack/transactions/:id")
  @RequirePermissions("topups.view")
  @ApiOperation({ summary: "Get single Paystack transaction" })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Paystack transaction details" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getPaystackTransaction(@Param("id") id: string) {
    return this.adminService.getPaystackTransaction(id);
  }

  // ============================================
  // KORA PAY MANAGEMENT
  // ============================================

  @Get("korapay/transactions")
  @RequirePermissions("topups.view")
  @ApiOperation({ summary: "Get Kora Pay transactions" })
  @ApiResponse({ status: 200, description: "Paginated Kora transactions" })
  async getKorapayTransactions(@Query() query: PaystackQueryDto) {
    return this.adminService.getKorapayTransactions(query);
  }

  @Get("korapay/transactions/:id")
  @RequirePermissions("topups.view")
  @ApiOperation({ summary: "Get single Kora Pay transaction" })
  @ApiParam({ name: "id", description: "Transaction ID" })
  @ApiResponse({ status: 200, description: "Kora transaction details" })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getKorapayTransaction(@Param("id") id: string) {
    return this.adminService.getKorapayTransaction(id);
  }

  // ============================================
  // APP SETTINGS
  // ============================================

  @Get("settings")
  @RequirePermissions("settings.view")
  @ApiOperation({ summary: "Get all app settings with metadata" })
  @ApiResponse({ status: 200, description: "All settings with full metadata" })
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  @Patch("settings")
  @RequirePermissions("settings.manage")
  @ApiOperation({ summary: "Bulk update app settings" })
  @ApiResponse({ status: 200, description: "Settings updated" })
  async bulkUpdateSettings(@Body() dto: BulkUpdateSettingsDto) {
    return this.settingsService.bulkUpdate(dto);
  }

  // ============================================
  // PROVIDER HEALTH
  // ============================================

  @Get("provider-health")
  @RequirePermissions("provider-health.view")
  @ApiOperation({ summary: "Get provider health status" })
  @ApiResponse({ status: 200, description: "Provider health data" })
  async getProviderHealth() {
    const data = await this.providerHealthService.getProviderHealth();
    return { success: true, data };
  }

  // ============================================
  // WITHDRAWALS
  // ============================================

  @Get("withdrawals")
  @RequirePermissions("withdrawals.view")
  @ApiOperation({ summary: "List all withdrawals (admin view)" })
  @ApiResponse({ status: 200, description: "Paginated withdrawals list" })
  async getWithdrawals(@Query() query: WithdrawalsQueryDto) {
    return this.adminService.getWithdrawals(query);
  }

  @Post("withdrawals/:id/approve")
  @RequirePermissions("wallet.debit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Approve a PENDING withdrawal — debits the user's wallet and marks the request SUCCESS",
  })
  @ApiParam({ name: "id", description: "Withdrawal ID" })
  @ApiResponse({ status: 200, description: "Approved withdrawal" })
  @ApiResponse({
    status: 400,
    description: "Withdrawal is not PENDING, or user balance dropped below the amount",
  })
  async approveWithdrawal(
    @Param("id") id: string,
    @Body() body: { note?: string },
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.approveWithdrawal(id, admin.sub, body?.note);
  }

  @Post("withdrawals/:id/reject")
  @RequirePermissions("wallet.debit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Reject a PENDING withdrawal — no wallet touch. A note explaining why is required.",
  })
  @ApiParam({ name: "id", description: "Withdrawal ID" })
  @ApiResponse({ status: 200, description: "Rejected withdrawal" })
  @ApiResponse({ status: 400, description: "Withdrawal is not PENDING, or note missing" })
  async rejectWithdrawal(
    @Param("id") id: string,
    @Body() body: { note: string },
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.rejectWithdrawal(id, admin.sub, body?.note);
  }

  /**
   * @deprecated Kept so the mobile app / older admin builds don't 500 while
   * the frontend is rolling out approve/reject. Delegates internally.
   */
  @Patch("withdrawals/:id/status")
  @RequirePermissions("wallet.debit")
  @ApiOperation({
    summary: "[Deprecated] Delegates to approve/reject. Use those instead.",
  })
  @ApiParam({ name: "id", description: "Withdrawal ID" })
  @ApiResponse({ status: 200, description: "Updated withdrawal" })
  async markWithdrawal(
    @Param("id") id: string,
    @Body() body: { status: "SUCCESS" | "FAILED"; note?: string },
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.markWithdrawal(id, admin.sub, body.status, body.note);
  }

  // ============================================
  // WALLET CREDIT REQUESTS
  // ============================================

  @Get("wallet/credit-requests")
  @RequirePermissions("wallet.credit")
  @ApiOperation({ summary: "List credit requests" })
  @ApiResponse({ status: 200, description: "Paginated credit requests" })
  async getCreditRequests(@Query() query: CreditRequestsQueryDto) {
    return this.adminService.getCreditRequests(query);
  }

  @Post("wallet/credit-requests")
  @RequirePermissions("wallet.credit")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a new wallet credit request" })
  @ApiResponse({ status: 201, description: "Credit request created" })
  @ApiResponse({ status: 404, description: "User not found" })
  async createCreditRequest(
    @Body() dto: CreateCreditRequestDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.createCreditRequest(dto, admin.sub);
  }

  @Post("wallet/credit-requests/:id/approve")
  @RequirePermissions("wallet.credit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve a credit request — credits user wallet" })
  @ApiParam({ name: "id", description: "Credit Request ID" })
  @ApiResponse({ status: 200, description: "Request approved, wallet credited" })
  @ApiResponse({ status: 400, description: "Cannot approve own request or already processed" })
  @ApiResponse({ status: 404, description: "Request not found" })
  async approveCreditRequest(
    @Param("id") id: string,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.approveCreditRequest(id, admin.sub);
  }

  @Post("wallet/credit-requests/:id/deny")
  @RequirePermissions("wallet.credit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Deny a credit request" })
  @ApiParam({ name: "id", description: "Credit Request ID" })
  @ApiResponse({ status: 200, description: "Request denied" })
  @ApiResponse({ status: 400, description: "Already processed" })
  @ApiResponse({ status: 404, description: "Request not found" })
  async denyCreditRequest(
    @Param("id") id: string,
    @Body() dto: DenyCreditRequestDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.denyCreditRequest(id, admin.sub, dto);
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================

  @Post("notifications/send")
  @RequirePermissions("notifications.manage")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send a notification to users" })
  @ApiResponse({ status: 200, description: "Notification sent" })
  async sendNotification(
    @Body() dto: SendNotificationDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminService.sendNotification(dto, admin.sub);
  }

  @Get("notifications/history")
  @RequirePermissions("notifications.view")
  @ApiOperation({ summary: "Get notification send history" })
  @ApiResponse({ status: 200, description: "Paginated notification logs" })
  async getNotificationHistory(@Query() query: NotificationsQueryDto) {
    return this.adminService.getNotificationHistory(query);
  }
}
