import { describe, expect, it } from "vitest";
import { isXtreamAccountActive } from "./xtream-account";

describe("isXtreamAccountActive", () => {
  it("accepts an authenticated active account with future expiry", () => {
    expect(isXtreamAccountActive({
      auth: 1,
      status: "Active",
      exp_date: "2000",
    }, 1000)).toBe(true);
  });

  it("accepts a non-expiring active account", () => {
    expect(isXtreamAccountActive({
      auth: 1,
      status: "Active",
      exp_date: "0",
    }, 1000)).toBe(true);
  });

  it("rejects an account whose provider status is expired", () => {
    expect(isXtreamAccountActive({
      auth: 1,
      status: "Expired",
      exp_date: "2000",
    }, 1000)).toBe(false);
  });

  it("rejects an account whose expiration timestamp has passed", () => {
    expect(isXtreamAccountActive({
      auth: 1,
      status: "Active",
      exp_date: "999",
    }, 1000)).toBe(false);
  });

  it("rejects unauthenticated responses", () => {
    expect(isXtreamAccountActive({
      auth: 0,
      status: "Active",
      exp_date: "2000",
    }, 1000)).toBe(false);
  });
});
