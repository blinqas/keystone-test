import { list } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import { text, checkbox } from '@keystone-6/core/fields';
import { Lists } from '.keystone/types';

function isAdmin({ session }: { session: any }) {
  // not a good example, but helpful for debugging
  return true;
}

export const lists: Lists = {
  // an example of field access control
  User: list({
    access: allowAll,
    fields: {
      // this field should be publicly readable
      displayName: text({
        access: {
          read: () => true,
        },
      }),

      // this field should only be readable by administrators
      name: text({
        access: {
          read: isAdmin,
          create: isAdmin,
          update: isAdmin,
        },
        isFilterable: false,
        isOrderable: false,
      }),

      email: text({
        access: {
          read: isAdmin,
        },
        isFilterable: false,
        isOrderable: false,
      }),

      isAdmin: checkbox({
        access: {
          read: isAdmin,
          update: isAdmin
        },
        isFilterable: false,
        isOrderable: false,
      }),
    },
    graphql: {
      omit: ['create', 'delete'],
    },
  }),
};
