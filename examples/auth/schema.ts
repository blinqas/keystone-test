import { list } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import { text, checkbox, password } from '@keystone-6/core/fields';
import type { Lists } from '.keystone/types';

type Session = {
  itemId: string;
  data?: {
    isAdmin: boolean;
  };
}

function hasSession({ session }: { session: Session | undefined }) {
  return Boolean(session)
}

function isAdminOrSameUser({ session, item }: { session: Session | undefined; item: Lists.User.Item }) {
  // you need to have a session to do this
  if (!session) return false;

  // admins can do anything
  if (session.data?.isAdmin) return true;

  // the authenticated user needs to be equal to the user we are updating
  return session.itemId === item.id;
}

function isAdminOrSameUserFilter({ session }: { session: Session | undefined; }) {
  // you need to have a session to do this
  if (!session) return false;

  // admins can see everything
  if (session.data?.isAdmin) return {};

  // the authenticated user can only see themselves
  return {
    id: {
      equals: session.itemId
    }
  }
}

function isAdmin({ session }: { session: any }) {
  // you need to have a session to do this
  if (!session) return false;

  // admins can do anything
  if (session.data.isAdmin) return true;

  // otherwise, no
  return false;
}

export const lists: Lists = {
  User: list({
    access: {
      operation: {
        create: allowAll,
        query: allowAll,

        // only allow users to update _anything_, but what they can update is limited by
        //   the access.filter.* and access.item.* access controls
        update: hasSession,

        // only allow admins to delete users
        delete: ({ session }) => session?.data.isAdmin,
      },
      filter: {
        update: isAdminOrSameUserFilter
      },
      item: {
        update: isAdminOrSameUser
      }
    },
    ui: {
      // since you can't delete users unless you're an admin, we hide the UI for it
      hideDelete: ({ session }) => !session?.data.isAdmin,
      listView: {
        // the default columns that will be displayed in the list view
        initialColumns: ['name', 'email', 'isAdmin'],
      },
    },
    fields: {
      // the user's name
      name: text({ validation: { isRequired: true } }),

      // the user's email address, used as the identity field for authentication
      //   we use isIndexed to enforce this email is unique
      email: text({
        // this field should only be readable by the respective user, or administrators
        access: {
          read: isAdminOrSameUser,
          update: isAdminOrSameUser
        },

        isFilterable: false,
        isOrderable: false,
        isIndexed: 'unique',
        validation: {
          isRequired: true
        }
      }),

      // the user's password, used as the secret field for authentication
      password: password({
        access: {
          read: isAdminOrSameUser,
          update: isAdminOrSameUser,
        },
        ui: {
          // the password field is hidden for the same reasons as access.update
          itemView: {
            fieldMode: ({ session, item }) => {
              if (isAdminOrSameUser({ session, item })) return 'edit';
              return 'hidden';
            },
          },
          listView: {
            // hidden except for admins
            fieldMode: ({ session }) => (session?.data?.isAdmin ? 'read' : 'hidden'),
          },
        },
      }),
      isAdmin: checkbox({
        access: {
          // only admins can create or update the isAdmin flag for users
          create: isAdmin,
          update: isAdmin,
        },
        ui: {
          // only admins can edit this field
          createView: {
            fieldMode: ({ session }) => (isAdmin({ session }) ? 'edit' : 'hidden'),
          },
          itemView: {
            fieldMode: ({ session }) => (isAdmin({ session }) ? 'edit' : 'read'),
          },
        },
      }),
    },
  }),
};
