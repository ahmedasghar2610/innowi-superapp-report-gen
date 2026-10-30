"use client";

import { contacts } from "@/lib/api/resources/contacts";
import { queryKeys } from "@/lib/query/query-keys";
import type { Contact, CreateContactInput, UpdateContactInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Contacts hooks — generated from the shared child-resource factory. §5. */
const hooks = createChildResourceHooks<Contact, CreateContactInput, UpdateContactInput>({
  key: queryKeys.merchants.contacts,
  list: contacts.list,
  create: contacts.create,
  update: contacts.update,
  remove: contacts.remove,
});

export const useContacts = hooks.useList;
export const useCreateContact = hooks.useCreate;
export const useUpdateContact = hooks.useUpdate;
export const useDeleteContact = hooks.useDelete;
