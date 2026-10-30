"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/client";
import { teams, type TeamAvailability, type TeamCalendar, type TeamsMeetingInput, type TeamsResult, type TeamsStatus } from "@/lib/api/resources/teams";

export const teamsStatusKey = ["ops", "teams", "status"] as const;

export function useTeamsStatus() {
  return useQuery<TeamsStatus, ApiError>({ queryKey: teamsStatusKey, queryFn: () => teams.status(), staleTime: 60_000 });
}

export function useTeamsTest() {
  return useMutation<TeamsResult, ApiError, "me" | "channel">({ mutationFn: (target) => teams.test(target) });
}

export function useTeamsDigest() {
  return useMutation<TeamsResult, ApiError, void>({ mutationFn: () => teams.digest() });
}

export function useTeamsMeeting() {
  const qc = useQueryClient();
  return useMutation<TeamsResult, ApiError, TeamsMeetingInput>({
    mutationFn: (input) => teams.meeting(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ops", "teams", "calendar"] }),
  });
}

/** Meetings and leave for the Ops Calendar (Teams meetings booked from tickets, Outlook, Fathom). */
export function useTeamsCalendar(start: string, end: string, mine: boolean) {
  return useQuery<TeamCalendar, ApiError>({
    queryKey: ["ops", "teams", "calendar", start, end, mine],
    queryFn: () => teams.calendar(start, end, mine),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useTeamAvailability() {
  return useQuery<TeamAvailability, ApiError>({
    queryKey: ["ops", "teams", "availability"],
    queryFn: () => teams.availability(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

