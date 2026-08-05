import unittest

import server


class SidebarOrderTests(unittest.TestCase):
    def test_workspace_normalizes_sidebar_order(self):
        workspace = server._normalize_workspace({
            'folders': [
                {'id': 'course', 'name': 'Course'},
                {'id': 'other', 'name': 'Other'},
            ],
            'sidebar_order': {
                '__root__': ['board:root', 'board:root', 'bad value'],
                'course': ['board:step-2', 'board:step-1', 4, None],
                'missing-folder': ['board:hidden'],
                'other': 'not-a-list',
            },
        })

        self.assertEqual(workspace['sidebar_order'], {
            '__root__': ['board:root'],
            'course': ['board:step-2', 'board:step-1'],
        })

    def test_workspace_defaults_to_empty_sidebar_order(self):
        workspace = server._normalize_workspace({'folders': []})
        self.assertEqual(workspace['sidebar_order'], {})


if __name__ == '__main__':
    unittest.main()
